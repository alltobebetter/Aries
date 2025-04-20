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

    // 当前模型设置
    let currentModel = 'gpt-4o-all'; // 默认模型

    // 消息历史记录，用于保存上下文
    let messageHistory = [];

    // 标记是否正在等待响应
    let isWaitingForResponse = false;

    // 根据北京时间设置问候语
    function setTimeGreeting() {
        // 创建北京时间对象（UTC+8）
        const now = new Date();
        const utc8Offset = 8 * 60; // 北京时间偏移分钟数
        const localOffset = now.getTimezoneOffset(); // 本地时区与UTC的偏移分钟数
        const totalOffset = utc8Offset + localOffset; // 本地时间与北京时间的偏移

        // 计算北京时间
        const beijingTime = new Date(now.getTime() + totalOffset * 60 * 1000);
        const hour = beijingTime.getHours();

        // 根据小时数设置问候语
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

        // 设置问候语
        timeGreeting.text(greeting);
    }

    // 初始化时调用一次
    setTimeGreeting();

    // 模型切换功能
    deepSearchBtn.on('click', function() {
        // 切换到深度搜索模型或取消
        if (currentModel === 'grok-3-deepersearch-r') {
            // 如果已经是深度搜索模型，则切换回默认模型
            currentModel = 'gpt-4o-all';
        } else {
            // 否则切换到深度搜索模型
            currentModel = 'grok-3-deepersearch-r';
        }
        updateModelButtons();
    });

    internetBtn.on('click', function() {
        // 切换到联网模型或取消
        if (currentModel === 'net-gpt-4o-all') {
            // 如果已经是联网模型，则切换回默认模型
            currentModel = 'gpt-4o-all';
        } else {
            // 否则切换到联网模型
            currentModel = 'net-gpt-4o-all';
        }
        updateModelButtons();
    });

    // 更新模型按钮状态
    function updateModelButtons() {
        // 移除所有按钮的活跃状态
        deepSearchBtn.removeClass('active');
        internetBtn.removeClass('active');

        // 根据当前模型设置活跃状态
        if (currentModel === 'grok-3-deepersearch-r') {
            deepSearchBtn.addClass('active');
        } else if (currentModel === 'net-gpt-4o-all') {
            internetBtn.addClass('active');
        }
    }

    // 发送消息函数
    function sendMessage() {
        // 如果正在等待响应，不允许发送
        if (isWaitingForResponse) return;

        const message = userInput.val().trim();
        if (message === '') return;

        // 清空输入框
        userInput.val('');

        // 移除发送按钮的可发送状态
        sendBtn.removeClass('send-btn-ready');

        // 隐藏欢迎消息，显示聊天开始
        chatArea.addClass('chat-started');

        // 设置正在等待响应状态
        isWaitingForResponse = true;

        // 禁用发送按钮
        sendBtn.prop('disabled', true);

        // 添加用户消息到聊天区域
        addMessage('我', message, 'user-message');

        // 将用户消息添加到历史记录
        messageHistory.push({role: 'user', content: message});

        // 限制历史记录最多10条对话（每条对话包含用户和助手的消息，所以需要限制为20条消息）
        if (messageHistory.length > 20) {
            // 移除最早的一对对话（用户和助手的消息）
            messageHistory = messageHistory.slice(2);
        }

        // 创建流式响应消息
        const messageId = createStreamMessage();

        // 发送请求到服务器，使用流式响应
        fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                model: currentModel, // 使用当前选择的模型
                history: messageHistory.slice(0, -1) // 发送除了当前消息外的历史记录
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

                    // 解码新收到的数据
                    const chunk = decoder.decode(value, { stream: true });

                    // 处理可能的多行数据
                    const lines = chunk.split('\n').filter(line => line.trim() !== '');

                    for (const line of lines) {
                        try {
                            // 解析JSON数据
                            const data = JSON.parse(line);
                            if (data.reply) {
                                // 只更新实际内容，而不是原始JSON
                                content = data.reply;
                                // 更新消息内容
                                updateStreamMessage(messageId, content);

                                // 如果是最终回复（完整回复），则添加到历史记录并移除光标
                                if (data.final === true) {
                                    // 将AI回复添加到历史记录
                                    messageHistory.push({role: 'assistant', content: content});

                                    // 移除光标，显示最终完整回复
                                    const messageBubble = $(`#${messageId} .message-bubble`);
                                    messageBubble.html(content);

                                    // 重置等待状态
                                    isWaitingForResponse = false;

                                    // 启用发送按钮
                                    sendBtn.prop('disabled', false);

                                    // 移除调试信息
                                }
                            } else if (data.error) {
                                // 处理错误消息
                                errorOccurred = true;
                                updateStreamMessage(messageId, `<span style="color: #e74c3c;">错误: ${data.error}</span>`);
                                console.error('Server error:', data.error);

                                // 重置等待状态
                                isWaitingForResponse = false;

                                // 启用发送按钮
                                sendBtn.prop('disabled', false);

                                // 不需要继续读取
                                return;
                            }
                        } catch (e) {
                            console.error('Error parsing JSON:', e, line);
                            // 如果是JSON解析错误，但不中断流的读取
                        }
                    }

                    // 继续读取流，除非发生了错误
                    if (!errorOccurred) {
                        return readStream();
                    }
                }).catch(streamError => {
                    // 处理流读取过程中的错误
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
            // 显示错误消息
            updateStreamMessage(messageId, `<span style="color: #e74c3c;">抱歉，发生了错误: ${error.message}</span>`);
            console.error('Fetch error:', error);

            // 重置等待状态
            isWaitingForResponse = false;

            // 启用发送按钮
            sendBtn.prop('disabled', false);
        });
    }

    // 添加消息到聊天区域
    function addMessage(_, content, className) {
        const messageHtml = `
            <div class="message ${className}">
                <div class="message-bubble">${content}</div>
            </div>
        `;
        chatMessages.append(messageHtml);
        scrollToBottom(true); // 使用延迟滚动，确保内容已经渲染
    }

    // 创建流式响应消息
    function createStreamMessage() {
        const messageId = 'message-' + Date.now();
        const messageHtml = `
            <div id="${messageId}" class="message bot-message">
                <div class="message-bubble">思考中<span class="cursor"></span></div>
            </div>
        `;
        chatMessages.append(messageHtml);
        scrollToBottom(true); // 使用延迟滚动，确保内容已经渲染
        return messageId;
    }

    // 更新流式响应消息
    function updateStreamMessage(messageId, content) {
        const messageBubble = $(`#${messageId} .message-bubble`);

        // 判断是否是错误消息（包含 HTML 标签）
        const isErrorMessage = content.includes('<span style="color: #e74c3c;">');

        // 如果是正常消息，添加光标
        if (!isErrorMessage) {
            messageBubble.html(content + '<span class="cursor"></span>');
        } else {
            // 如果是错误消息，直接显示错误内容，不添加光标
            messageBubble.html(content);
        }

        // 使用MutationObserver监听消息内容变化，确保滚动位置始终正确
        if (!messageBubble.data('observer')) {
            const observer = new MutationObserver(function() {
                scrollToBottom(true); // 使用延迟滚动，确保内容已经渲染
            });

            observer.observe(messageBubble[0], {
                childList: true,
                subtree: true,
                characterData: true
            });

            messageBubble.data('observer', observer);
        }

        scrollToBottom(true); // 使用延迟滚动，确保内容已经渲染
    }

    // 滚动到底部，确保最后一条消息完全可见并且与输入框保持足够距离
    function scrollToBottom(withDelay = false) {
        const scrollFunc = function() {
            // 获取最后一条消息元素
            const lastMessage = chatMessages.children().last();

            if (lastMessage.length) {
                // 获取输入框容器的位置
                const inputContainerTop = $('.input-container').offset().top;
                const chatAreaTop = chatArea.offset().top;

                // 计算输入框相对于聊天区域的位置
                const inputRelativeTop = inputContainerTop - chatAreaTop;

                // 计算需要滚动的位置：最后一条消息的位置 + 消息高度
                const lastMessagePosition = lastMessage.position().top + lastMessage.outerHeight(true);

                // 增加额外的空间，确保消息和输入框之间有足够的距离
                // 计算消息底部到输入框顶部的距离，至少保持200px的间距
                const minGap = 200; // 最小间距，可以根据需要调整
                const currentGap = inputRelativeTop - lastMessagePosition;

                // 如果当前间距小于最小间距，则进行滚动调整
                if (currentGap < minGap) {
                    const additionalScroll = minGap - currentGap;
                    const scrollPosition = chatArea.scrollTop() + additionalScroll;
                    chatArea.scrollTop(scrollPosition);
                }
            } else {
                // 如果没有消息，则滚动到底部
                chatArea.scrollTop(chatArea[0].scrollHeight);
            }
        };

        // 如果需要延迟，则等待一小段时间再滚动，确保内容已经渲染完成
        if (withDelay) {
            setTimeout(scrollFunc, 100);
        } else {
            scrollFunc();
        }
    }

    // 按键事件处理

    // 监听输入框内容变化，更新发送按钮状态
    userInput.on('input', function() {
        if ($(this).val().trim() !== '') {
            // 有内容时添加可发送状态
            sendBtn.addClass('send-btn-ready');
        } else {
            // 无内容时移除可发送状态
            sendBtn.removeClass('send-btn-ready');
        }
    });

    // 按下回车键发送，除非按下Shift键
    userInput.on('keydown', function(e) {
        if (e.which === 13 && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 发送按钮点击事件
    sendBtn.on('click', function() {
        sendMessage();
    });

    // 上传文件按钮点击事件
    uploadBtn.on('click', function() {
        // 触发隐藏的文件输入元素的点击
        fileUpload.click();
    });

    // 文件选择后的处理
    fileUpload.on('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        // 添加上传中的视觉反馈到按钮
        uploadBtn.addClass('upload-btn-loading').prop('disabled', true);

        // 创建FormData对象
        const formData = new FormData();
        formData.append('file', file);

        // 发送文件到后端上传接口
        fetch('/upload', {
            method: 'POST',
            // 不需要设置请求头，让浏览器自动处理
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.code === 0 && data.data && data.data.url) {
                // 成功上传，将文件链接插入到输入框
                const fileLink = data.data.url;
                const fileName = data.data.filename || file.name;
                const isImage = data.data.image;

                // 获取当前输入框文本
                let currentText = userInput.val();

                // 根据文件类型添加不同的链接格式
                if (isImage) {
                    // 如果是图片，添加图片链接
                    userInput.val(currentText + `![${fileName}](${fileLink}) `);
                } else {
                    // 如果是其他文件，添加普通链接
                    userInput.val(currentText + `[${fileName}](${fileLink}) `);
                }

                // 聚焦到输入框
                userInput.focus();
            } else {
                // 上传失败，显示错误提示
                console.error('文件上传失败:', data.msg || '未知错误');
                alert(`文件上传失败: ${data.msg || '未知错误'}`);
            }
        })
        .catch(error => {
            // 处理错误
            console.error('File upload error:', error);
            alert(`文件上传错误: ${error.message}`);
        })
        .finally(() => {
            // 清空文件输入，以便下次上传同一文件时也能触发change事件
            fileUpload.val('');

            // 恢复上传按钮状态
            uploadBtn.removeClass('upload-btn-loading').prop('disabled', false);
        });
    });

    // 初始化时聚焦输入框
    userInput.focus();

    // 初始化时检查输入框是否有内容
    if (userInput.val().trim() !== '') {
        sendBtn.addClass('send-btn-ready');
    }

    // 页面加载完成后，确保滚动到正确位置
    $(window).on('load', function() {
        if (chatMessages.children().length > 0) {
            // 使用较长的延迟确保所有内容已加载
            setTimeout(function() {
                scrollToBottom(true);
            }, 300);
        }
    });

    // 添加窗口大小改变事件监听器，确保滚动位置正确
    $(window).on('resize', function() {
        // 如果有消息，则重新计算滚动位置
        if (chatMessages.children().length > 0) {
            scrollToBottom(true); // 使用延迟滚动，确保内容已经渲染
        }
    });
});
