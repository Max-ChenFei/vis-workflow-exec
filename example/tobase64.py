import base64

with open('image.tif', 'rb') as f:
    data = f.read()
    b64_str = base64.b64encode(data).decode('utf-8')

# 去除换行和空格，保证字符串连续
b64_str = b64_str.replace('\n', '').replace(' ', '')

# 保存到文件（可选）
with open('image_base64.txt', 'w') as f:
    f.write(b64_str)