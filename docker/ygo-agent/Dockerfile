# The inference server from sbl1996/ygo-agent (MIT), at a pinned commit.
# Built from a snapshot because the repo's submodules break a git build.
FROM python:3.10.14-slim-bookworm
# This commit's code_list.txt (864 cards) is the one the released checkpoint was
# trained with; later ones list cards it has no embedding for.
ARG COMMIT=13e22951c886697115a7ff078de172f3e8fa9f08
WORKDIR /usr/src/app
ADD https://github.com/sbl1996/ygo-agent/archive/${COMMIT}.tar.gz /tmp/src.tar.gz
RUN tar -xzf /tmp/src.tar.gz -C /tmp \
 && cp -r /tmp/ygo-agent-${COMMIT}/ygoinf/. . \
 && cp /tmp/ygo-agent-${COMMIT}/assets/log_conf.yaml /tmp/ygo-agent-${COMMIT}/scripts/code_list.txt . \
 && rm -rf /tmp/src.tar.gz /tmp/ygo-agent-${COMMIT} \
 && pip install --no-cache-dir -e .
ADD https://github.com/sbl1996/ygo-agent/releases/download/v0.1/0546_26550M.tflite ./
ENV CHECKPOINT=0546_26550M.tflite
EXPOSE 3000
CMD ["uvicorn", "ygoinf.server:app", "--host", "0.0.0.0", "--port", "3000", "--log-config=log_conf.yaml"]
