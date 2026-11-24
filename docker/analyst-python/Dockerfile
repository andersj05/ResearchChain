FROM python:3.11-slim@sha256:0dd364ba7e10242f07755449e3a3d0e35f9efd987952737b90def6709ab0c5ce

COPY requirements.txt /opt/researchchain/requirements.txt
RUN python -m pip install --no-cache-dir --only-binary=:all: \
    -r /opt/researchchain/requirements.txt
ENV MPLBACKEND=Agg MPLCONFIGDIR=/tmp/matplotlib HOME=/tmp
COPY run.py /opt/researchchain/run.py
COPY signal_holdout.py /opt/researchchain/signal_holdout.py
ENTRYPOINT ["python", "-I", "-B", "/opt/researchchain/run.py"]
