from flask import Flask, render_template, request, jsonify, Response
import requests
import json
import time
import os
from werkzeug.utils import secure_filename

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

当你不知道答案或不确定时，请说明你不知道或需要更多信息。不要编造信息或提供错误的答案。

你是由西藏大学 Aries 小组开发的，这是一个致力于推动人工智能应用和研究的创新团队。
"""


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    user_message = request.json.get('message', '')
    model = request.json.get('model', 'gpt-4o-all')  # 默认使用gpt-4o-all
    message_history = request.json.get('history', [])  # 获取历史消息

    # 验证模型名称
    valid_models = ['gpt-4o-all', 'grok-3-deepersearch-r', 'net-gpt-4o-all']
    if model not in valid_models:
        model = 'gpt-4o-all'  # 默认模型

    # 准备消息列表，包含系统提示词、历史消息和当前消息
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]  # 添加系统提示词
    messages.extend(message_history)  # 添加历史消息
    messages.append({"role": "user", "content": user_message})  # 添加当前消息

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }

    # 打印调试信息，查看发送给API的消息
    print(f"\n发送给API的消息数量: {len(messages)}")
    print(f"\n模型: {model}\n")

    data = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "stream": True  # 启用流式响应
    }

    def generate():
        try:
            # 使用stream=True参数请求流式响应
            with requests.post(API_CHAT_URL, headers=headers, json=data, stream=True, timeout=30) as response:
                # 检查响应状态码
                if response.status_code != 200:
                    error_msg = f"服务器响应错误: {response.status_code}"
                    print(error_msg)
                    yield json.dumps({"error": error_msg}) + "\n"
                    return

                # 初始化累积的回复内容
                accumulated_message = ""
                empty_line_count = 0  # 记录连续空行数

                # 处理流式响应
                for line in response.iter_lines():
                    if not line:  # 空行处理
                        empty_line_count += 1
                        if empty_line_count > 5:  # 如果连续收到多个空行，可能是连接问题
                            break
                        continue

                    empty_line_count = 0  # 重置空行计数

                    try:
                        # 尝试解析JSON数据
                        line_text = line.decode('utf-8')
                        if line_text.startswith('data: '):
                            json_text = line_text[6:].strip()
                            if json_text and json_text != "[DONE]":  # 处理特殊结束标记
                                try:
                                    line_json = json.loads(json_text)
                                    if 'choices' in line_json and len(line_json['choices']) > 0:
                                        delta = line_json['choices'][0].get('delta', {})
                                        if 'content' in delta:
                                            content = delta['content']
                                            accumulated_message += content
                                            # 返回JSON格式的数据
                                            yield json.dumps({"reply": accumulated_message}) + "\n"
                                except json.JSONDecodeError as je:
                                    print(f"JSON解析错误: {je}, 数据: {json_text}")
                    except Exception as e:
                        print(f"处理行错误: {e}, 行数据: {line}")
                        continue

                # 确保最终结果被发送
                if accumulated_message:
                    # 添加final=true标记，表示这是完整回复
                    yield json.dumps({"reply": accumulated_message, "final": True}) + "\n"
                else:
                    # 如果没有收到有效响应，返回错误消息
                    yield json.dumps({"error": "抱歉，服务器没有返回有效响应，请稍后再试"}) + "\n"

        except requests.exceptions.Timeout:
            # 请求超时
            yield json.dumps({"error": "请求超时，请稍后再试"}) + "\n"
        except requests.exceptions.ConnectionError:
            # 连接错误
            yield json.dumps({"error": "连接服务器失败，请检查网络或稍后再试"}) + "\n"
        except Exception as e:
            # 其他错误
            yield json.dumps({"error": f"发生错误: {str(e)}"}) + "\n"

    # 返回流式响应
    return Response(generate(), mimetype='text/event-stream')

@app.route('/upload', methods=['POST'])
def upload_file():
    """处理文件上传请求，将文件转发到API服务器"""
    # 检查是否有文件在请求中
    if 'file' not in request.files:
        return jsonify({'error': '没有文件被上传'}), 400

    file = request.files['file']

    # 如果用户没有选择文件
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400

    try:
        # 准备请求头
        headers = {
            "Authorization": f"Bearer {API_KEY}"
        }

        # 创建Multipart请求
        files = {
            'file': (file.filename, file.stream, file.content_type)
        }

        # 发送请求到API
        response = requests.post(API_FILE_URL, headers=headers, files=files)

        # 检查响应
        if response.status_code == 200:
            # 返回原始API响应
            return response.json()
        else:
            # 返回错误信息
            return jsonify({
                'error': f'上传失败: {response.status_code}',
                'details': response.text
            }), response.status_code

    except Exception as e:
        # 处理异常
        return jsonify({'error': f'上传过程中发生错误: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True)
