$(document).ready(function() {
    const chatMessages = $('#chat-messages');
    const userInput = $('#user-input');
    const chatArea = $('.chat-area');
    const timeGreeting = $('#time-greeting');
    const deepSearchBtn = $('#deep-search-btn');
    const internetBtn = $('#internet-btn');
    const sendBtn = $('#send-btn');
    const uploadBtn = $('#upload-btn');
    const fileUpload = $('#file-upload');
    const modelDropdownBtn = $('#model-dropdown-btn');
    const modelDropdown = $('#model-dropdown');
    const modelOptions = $('.model-option');
    const currentModelName = $('#current-model-name');

    let currentModel = 'gpt-4o-mini';
    let messageHistory = [];
    let isWaitingForResponse = false;

    const modelNameMap = {
        'gpt-4o-mini': 'Aries Quick',
        'gpt-4o-all': 'Aries Stable',
        'grok-3-deepersearch-r': 'Aries Deepsearch',
        'net-gpt-4o-all': 'Aries Net',
        'grok-3-think': 'Aries Thinking',
        'gpt-4o-image-vip': 'Aries Artist'
    };

    function setTimeGreeting() {
        const now = new Date();
        const hour = now.getHours();

        let greeting = '';
        if (hour >= 5 && hour < 9) {
            greeting = '早上好';
        } else if (hour >= 9 && hour < 11) {
            greeting = '上午好';
        } else if (hour >= 11 && hour < 13) {
            greeting = '中午好';
        } else if (hour >= 13 && hour < 18) {
            greeting = '下午好';
        } else if (hour >= 18 && hour < 23) {
            greeting = '晚上好';
        } else {
            greeting = '夜里好';
        }

        timeGreeting.text(greeting);
    }

    setTimeGreeting();

    deepSearchBtn.on('click', function(e) {
        console.log('Deep search button clicked');
        e.preventDefault();

        if (currentModel === 'grok-3-deepersearch-r') {
            currentModel = 'gpt-4o-mini';
        } else {
            currentModel = 'grok-3-deepersearch-r';
        }
        updateModelButtons();
    });

    internetBtn.on('click', function(e) {
        console.log('Internet button clicked');
        e.preventDefault();

        if (currentModel === 'net-gpt-4o-all') {
            currentModel = 'gpt-4o-mini';
        } else {
            currentModel = 'net-gpt-4o-all';
        }
        updateModelButtons();
    });

    function updateModelButtons() {
        console.log('Updating model buttons, current model:', currentModel);

        deepSearchBtn.removeClass('active');
        internetBtn.removeClass('active');

        if (currentModel === 'grok-3-deepersearch-r') {
            console.log('Activating deep search button');
            deepSearchBtn.addClass('active');
        } else if (currentModel === 'net-gpt-4o-all') {
            console.log('Activating internet button');
            internetBtn.addClass('active');
        }

        currentModelName.text(modelNameMap[currentModel]);

        modelOptions.removeClass('selected');
        const selectedOption = $(`.model-option[data-model="${currentModel}"]`);
        console.log('Selected option found:', selectedOption.length > 0);
        selectedOption.addClass('selected');

        if (currentModel === 'gpt-4o-mini') {
            console.log('Disabling upload button for Quick model');
            uploadBtn.prop('disabled', true).css('opacity', '0.5').attr('title', '当前模型不支持文件上传');
        } else {
            uploadBtn.prop('disabled', false).css('opacity', '1').attr('title', '上传文件');
        }
    }

    function sendMessage() {
        if (isWaitingForResponse) return;

        const message = userInput.val().trim();
        if (message === '') return;

        userInput.val('');
        sendBtn.removeClass('send-btn-ready');
        chatArea.addClass('chat-started');
        isWaitingForResponse = true;
        sendBtn.prop('disabled', true);

        addMessage('我', message, 'user-message');
        messageHistory.push({role: 'user', content: message});
        if (messageHistory.length > 20) {
            messageHistory = messageHistory.slice(2);
        }

        const messageId = createStreamMessage();

        fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                model: currentModel,
                history: messageHistory.slice(0, -1)
            }),
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`服务器响应错误: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let content = '';
            let errorOccurred = false;

            function readStream() {
                return reader.read().then(({ done, value }) => {
                    if (done) {
                        return;
                    }

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n').filter(line => line.trim() !== '');

                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);
                            if (data.reply) {
                                content = data.reply;
                                updateStreamMessage(messageId, content);

                                if (data.final === true) {
                                    messageHistory.push({role: 'assistant', content: content});
                                    const messageBubble = $(`#${messageId} .message-bubble`);
                                    // 对最终消息进行Markdown解析
                                    messageBubble.html(parseMarkdown(content));
                                    isWaitingForResponse = false;
                                    sendBtn.prop('disabled', false);
                                }
                            } else if (data.error) {
                                errorOccurred = true;
                                updateStreamMessage(messageId, `<span style="color: #e74c3c;">错误: ${data.error}</span>`);
                                console.error('Server error:', data.error);
                                isWaitingForResponse = false;
                                sendBtn.prop('disabled', false);
                                return;
                            }
                        } catch (e) {
                            console.error('Error parsing JSON:', e, line);
                        }
                    }

                    if (!errorOccurred) {
                        return readStream();
                    }
                }).catch(streamError => {
                    console.error('Stream reading error:', streamError);
                    if (!errorOccurred) {
                        errorOccurred = true;
                        updateStreamMessage(messageId, `<span style="color: #e74c3c;">读取响应时发生错误，请稍后再试</span>`);
                    }
                });
            }

            return readStream();
        })
        .catch(error => {
            updateStreamMessage(messageId, `<span style="color: #e74c3c;">抱歉，发生了错误: ${error.message}</span>`);
            console.error('Fetch error:', error);
            isWaitingForResponse = false;
            sendBtn.prop('disabled', false);
        });
    }

    function addMessage(_, content, className) {
        let processedContent;

        if (className === 'bot-message') {
            processedContent = parseMarkdown(content);
        } else {
            processedContent = escapeHtml(content);
        }

        const messageHtml = `
            <div class="message ${className}">
                <div class="message-bubble">${processedContent}</div>
            </div>
        `;
        chatMessages.append(messageHtml);
        scrollToBottom(true);
    }

    function createStreamMessage() {
        const messageId = 'message-' + Date.now();
        const messageHtml = `
            <div id="${messageId}" class="message bot-message">
                <div class="message-bubble">思考中<span class="cursor"></span></div>
            </div>
        `;
        chatMessages.append(messageHtml);
        scrollToBottom(true);
        return messageId;
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    const renderer = new marked.Renderer();

    renderer.link = function(href, title, text) {
        const link = marked.Renderer.prototype.link.apply(this, arguments);
        return link.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
    };

    marked.setOptions({
        renderer: renderer, 
        breaks: true,
        gfm: true,
        headerIds: false,
        mangle: false,
        smartLists: true,
    });

    function parseMarkdown(content) {
        try {
            const escapedContent = escapeHtml(content);
            const parsedContent = marked.parse(escapedContent);
            return DOMPurify.sanitize(parsedContent, {
                USE_PROFILES: { html: true },
                FORBID_TAGS: ['style', 'script'],
                FORBID_ATTR: ['style', 'onerror', 'onload']
            });
        } catch (e) {
            console.error('Markdown解析错误:', e);
            return escapeHtml(content);
        }
    }

    function updateStreamMessage(messageId, content) {
        const messageBubble = $(`#${messageId} .message-bubble`);
        const isErrorMessage = content.includes('<span style="color: #e74c3c;">');

        if (!isErrorMessage) {
            messageBubble.html(parseMarkdown(content) + '<span class="cursor"></span>');
        } else {
            messageBubble.html(content);
        }

        if (!messageBubble.data('observer')) {
            const observer = new MutationObserver(function() {
                scrollToBottom(true);
            });

            observer.observe(messageBubble[0], {
                childList: true,
                subtree: true,
                characterData: true
            });

            messageBubble.data('observer', observer);
        }

        scrollToBottom(true);
    }

    function scrollToBottom(withDelay = false) {
        const scrollFunc = function() {
            const lastMessage = chatMessages.children().last();

            if (lastMessage.length) {
                const inputContainerTop = $('.input-container').offset().top;
                const chatAreaTop = chatArea.offset().top;
                const inputRelativeTop = inputContainerTop - chatAreaTop;
                const lastMessagePosition = lastMessage.position().top + lastMessage.outerHeight(true);
                const minGap = 200;
                const currentGap = inputRelativeTop - lastMessagePosition;

                if (currentGap < minGap) {
                    const additionalScroll = minGap - currentGap;
                    const scrollPosition = chatArea.scrollTop() + additionalScroll;
                    chatArea.scrollTop(scrollPosition);
                }
            } else {
                chatArea.scrollTop(chatArea[0].scrollHeight);
            }
        };

        if (withDelay) {
            setTimeout(scrollFunc, 100);
        } else {
            scrollFunc();
        }
    }

    userInput.on('input', function() {
        if ($(this).val().trim() !== '') {
            sendBtn.addClass('send-btn-ready');
        } else {
            sendBtn.removeClass('send-btn-ready');
        }
    });

    userInput.on('keydown', function(e) {
        if (e.which === 13 && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn.on('click', function() {
        sendMessage();
    });

    uploadBtn.on('click', function() {
        fileUpload.click();
    });

    fileUpload.on('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        uploadBtn.addClass('upload-btn-loading').prop('disabled', true);

        const formData = new FormData();
        formData.append('file', file);

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.code === 0 && data.data && data.data.url) {
                const fileLink = data.data.url;
                const fileName = data.data.filename || file.name;
                const isImage = data.data.image;
                let currentText = userInput.val();

                if (isImage) {
                    userInput.val(currentText + `![${fileName}](${fileLink}) `);
                } else {
                    userInput.val(currentText + `[${fileName}](${fileLink}) `);
                }

                userInput.focus();
            } else {
                console.error('文件上传失败:', data.msg || '未知错误');
                alert(`文件上传失败: ${data.msg || '未知错误'}`);
            }
        })
        .catch(error => {
            console.error('File upload error:', error);
            alert(`文件上传错误: ${error.message}`);
        })
        .finally(() => {
            fileUpload.val('');
            uploadBtn.removeClass('upload-btn-loading').prop('disabled', false);
        });
    });

    userInput.focus();

    if (userInput.val().trim() !== '') {
        sendBtn.addClass('send-btn-ready');
    }

    $(window).on('load', function() {
        if (chatMessages.children().length > 0) {
            setTimeout(function() {
                scrollToBottom(true);
            }, 300);
        }
    });

    $(window).on('resize', function() {
        if (chatMessages.children().length > 0) {
            scrollToBottom(true);
        }
    });

    modelDropdownBtn.on('click', function(e) {
        e.stopPropagation();
        modelDropdown.toggleClass('show');
    });

    modelOptions.on('click', function(e) {
        e.stopPropagation();

        const selectedModel = $(this).data('model');
        console.log('Model option clicked:', selectedModel);

        currentModel = selectedModel;

        updateModelButtons();

        modelDropdown.removeClass('show');
    });

    $(document).on('click', function(e) {
        if (!$(e.target).closest('.model-selector').length) {
            modelDropdown.removeClass('show');
        }
    });

    updateModelButtons();
});