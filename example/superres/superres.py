import numpy as np
import torch
import sys

def superres(input_array):
    try:
        # 避免导入api模块出现的打印内容干扰输出
        from api import super_resolution
        
        if torch.cuda.is_available():
            image = torch.unsqueeze(torch.unsqueeze(torch.from_numpy(input_array.astype(np.float32)), 0), 0).cuda()
        else:
            image = torch.unsqueeze(torch.unsqueeze(torch.from_numpy(input_array.astype(np.float32)), 0), 0)

        sys.stderr.write("Running super_resolution function\n")
        super_res_image = super_resolution(image, 2)
        sys.stderr.write("Super resolution completed\n")
        
        # 转换为numpy数组并返回
        result = super_res_image.cpu().detach().numpy()
        sys.stderr.write(f"Result shape: {result.shape}\n")
        return result
    except Exception as e:
        sys.stderr.write(f"Error in superres function: {str(e)}\n")
        # 如果发生错误，返回一个空的numpy数组
        return np.zeros((1, 1, 128, 128), dtype=np.float32)