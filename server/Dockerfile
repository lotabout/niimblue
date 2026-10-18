FROM python:3.12-alpine
WORKDIR /app
COPY storage_server.py border_storage.py ./
RUN addgroup -S niimblue && adduser -S -G niimblue niimblue && mkdir /data && chown niimblue:niimblue /data
USER niimblue
ENV NIIMBLUE_STORAGE_HOST=0.0.0.0 NIIMBLUE_STORAGE_DB=/data/labels.sqlite3 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8787
VOLUME ["/data"]
CMD ["python3", "storage_server.py"]
