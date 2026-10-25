FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8090
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:8090", "--access-logfile", "-", "app:app"]
