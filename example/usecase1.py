from skimage.exposure import equalize_adapthist
import numpy as np
import torch
from api import super_resolution
from skimage.filters import gaussian
from skimage.io import imread

raw_image = imread('image.tif', as_gray=True)

gaussian_filtered = gaussian(raw_image, sigma=0.5)

if torch.cuda.is_available():
    image = torch.unsqueeze(torch.unsqueeze(torch.from_numpy(gaussian_filtered.astype(np.float32)), 0), 0).cuda()

super_res_image = super_resolution(image, 2)

contrast_enhanced = equalize_adapthist(np.squeeze(super_res_image.cpu().detach().numpy()))