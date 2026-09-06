FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

# 数据目录：数据库 + 截图都在这里，docker-compose 挂载卷即可持久化
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8088
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:8088", "--access-logfile", "-", "app:app"]
