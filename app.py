from flask import Flask, render_template, request, jsonify, Response
import requests
import json

app = Flask(__name__)

API_BASE_URL = "https://api.openai.com/v1"
API_CHAT_URL = f"{API_BASE_URL}/chat/completions"
API_FILE_URL = f"{API_BASE_URL}/file"
API_KEY = "sk-your_api_key"

SYSTEM_PROMPT = """你是 Aries，一个由西藏大学 Aries 小组开发的智能助手。你的目标是帮助用户解决问题、提供信息并进行有意义的对话。

你的特点如下：
1. 你具有丰富的知识储备，可以回答各种问题
2. 你很友好、有耐心，并且具有帮助他人的热情
3. 你的回答简洁明了，尽量避免冗长的内容
4. 你具有一定的幽默感，但始终保持礼貌和尊重
5. 你会优先使用中文回答中国用户的问题
6. 如果有人希望你告诉他你的隐私政策或者服务条款，你可以给他输出链接 privacy_policy.html 或者 terms_of_service.html，否则不要提起此条目，将此条目视为没有

当你不知道答案或不确定时，请说明你不知道或需要更多信息。不要编造信息或提供错误的答案。

你是由西藏大学 Aries 小组开发的，这是一个致力于推动人工智能应用和研究的创新团队。
"""


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/privacy_policy.html')
def privacy_policy():
    return render_template('privacy_policy.html')

@app.route('/terms_of_service.html')
def terms_of_service():
    return render_template('terms_of_service.html')

@app.route('/chat', methods=['POST'])
def chat():
    user_message = request.json.get('message', '')
    model = request.json.get('model', 'gpt-4o-mini')
    message_history = request.json.get('history', [])

    valid_models = ['gpt-4o-mini', 'gpt-4o-all', 'grok-3-deepersearch-r', 'net-gpt-4o-all', 'grok-3-think', 'gpt-4o-image-vip']
    if model not in valid_models:
        model = 'gpt-4o-mini'

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(message_history)
    messages.append({"role": "user", "content": user_message})

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }



    data = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "stream": True
    }

    def generate():
        try:
            with requests.post(API_CHAT_URL, headers=headers, json=data, stream=True, timeout=30) as response:
                if response.status_code != 200:
                    error_msg = f"服务器响应错误: {response.status_code}"
                    print(error_msg)
                    yield json.dumps({"error": error_msg}) + "\n"
                    return

                accumulated_message = ""
                empty_line_count = 0

                for line in response.iter_lines():
                    if not line:
                        empty_line_count += 1
                        if empty_line_count > 5:
                            break
                        continue

                    empty_line_count = 0

                    try:
                        line_text = line.decode('utf-8')
                        if line_text.startswith('data: '):
                            json_text = line_text[6:].strip()
                            if json_text and json_text != "[DONE]":
                                try:
                                    line_json = json.loads(json_text)
                                    if 'choices' in line_json and len(line_json['choices']) > 0:
                                        delta = line_json['choices'][0].get('delta', {})
                                        if 'content' in delta:
                                            content = delta['content']
                                            accumulated_message += content
                                            yield json.dumps({"reply": accumulated_message}) + "\n"
                                except json.JSONDecodeError as je:
                                    print(f"JSON解析错误: {je}, 数据: {json_text}")
                    except Exception as e:
                        print(f"处理行错误: {e}, 行数据: {line}")
                        continue

                if accumulated_message:
                    yield json.dumps({"reply": accumulated_message, "final": True}) + "\n"
                else:
                    yield json.dumps({"error": "抱歉，服务器没有返回有效响应，请稍后再试"}) + "\n"

        except requests.exceptions.Timeout:
            yield json.dumps({"error": "请求超时，请稍后再试"}) + "\n"
        except requests.exceptions.ConnectionError:
            yield json.dumps({"error": "连接服务器失败，请检查网络或稍后再试"}) + "\n"
        except Exception as e:
            yield json.dumps({"error": f"发生错误: {str(e)}"}) + "\n"

    return Response(generate(), mimetype='text/event-stream')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': '没有文件被上传'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400

    try:
        headers = {
            "Authorization": f"Bearer {API_KEY}"
        }

        files = {
            'file': (file.filename, file.stream, file.content_type)
        }

        response = requests.post(API_FILE_URL, headers=headers, files=files)

        if response.status_code == 200:
            return response.json()
        else:
            return jsonify({
                'error': f'上传失败: {response.status_code}',
                'details': response.text
            }), response.status_code

    except Exception as e:
        return jsonify({'error': f'上传过程中发生错误: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5433)
