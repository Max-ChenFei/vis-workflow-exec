FROM python:3.11

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    wget \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN git clone https://github.com/Luchixiang/EMDiffuse .

# Install EMDiffuse requirements first
RUN pip install --no-cache-dir -r requirements.txt

# Then install our custom requirements
COPY requirements.txt /app/custom_requirements.txt
RUN pip install --no-cache-dir -r custom_requirements.txt

RUN wget -O api.py https://raw.githubusercontent.com/Max-ChenFei/super_resolution/main/api.py

COPY superres.py run.py /app/

CMD ["python", "run.py"]