# 使用官方 Python 运行时作为父镜像
FROM python:3.10-slim

# 在容器中设置工作目录
WORKDIR /app

# 复制需求文件并安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用程序代码的其余部分
COPY . .

# 公开应用运行的端口
EXPOSE 8000

# 运行应用
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
