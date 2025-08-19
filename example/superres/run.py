import numpy as np
import argparse
import base64
import io
import sys
from superres import superres as process_image

def parse_arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=str, help='Input base64 encoded image')
    parser.add_argument('--input-file', type=str, help='File containing input base64 encoded image')
    return parser.parse_args()

def b64_to_array(b64_str):
    try:
        decoded = base64.b64decode(b64_str)
        buf = io.BytesIO(decoded)
        return np.load(buf)  # 使用np.load读取numpy数组
    except Exception as e:
        sys.stderr.write(f"Error decoding base64: {str(e)}\n")
        # 如果解码失败，尝试将输入视为UTF-8编码的字符串
        try:
            # 尝试将输入转换为ASCII兼容的字符串
            clean_str = ''.join(c for c in b64_str if ord(c) < 128)
            decoded = base64.b64decode(clean_str)
            buf = io.BytesIO(decoded)
            return np.load(buf)
        except Exception as e2:
            sys.stderr.write(f"Second attempt failed: {str(e2)}\n")
            raise

def array_to_b64(array):
    buf = io.BytesIO()
    np.save(buf, array)
    buf.seek(0)
    return base64.b64encode(buf.getvalue()).decode('utf-8')

def run():
    args = parse_arguments()
    
    # 从文件读取或直接使用命令行参数
    if args.input_file:
        with open(args.input_file, 'r') as f:
            input_data = f.read().strip()
    else:
        input_data = args.input
    
    try:
        sys.stderr.write("Processing input data...\n")
        input_array = b64_to_array(input_data)
        sys.stderr.write(f"Input array shape: {input_array.shape}\n")
        result_array = process_image(input_array)
        sys.stderr.write(f"Result array shape: {result_array.shape}\n")
        result_b64 = array_to_b64(result_array)
        sys.stderr.write("Successfully encoded result to base64\n")
        # 确保直接输出到stdout并刷新缓冲区
        sys.stdout.write(result_b64)
        sys.stdout.flush()
    except Exception as e:
        sys.stderr.write(f"Error in processing: {str(e)}\n")
        # 即使发生错误，也返回一个有效的base64编码的空数组
        empty_array = np.zeros((1, 1, 128, 128), dtype=np.float32)
        sys.stdout.write(array_to_b64(empty_array))
        sys.stdout.flush()
        sys.exit(1)

if __name__ == "__main__":
    run()