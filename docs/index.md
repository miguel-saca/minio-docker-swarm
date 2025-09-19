---
layout: default
title: MinIO on Docker Swarm — Production Guide
description: Distributed, S3-compatible object storage on Docker Swarm with XFS, erasure coding, NGINX, secrets, health checks, metrics, and zero-downtime upgrades.
---

# MinIO on Docker Swarm — Production Guide

<div class="alert info">
<p>This site mirrors the repository’s manual and is optimized for SEO. You can also read the single-file guide in the repo root: <strong>README-minio-swarm.md</strong>.</p>
</div>

# Production-Ready MinIO on Docker Swarm (Distributed / Multi-Node)

*A complete, opinionated guide aligned with MinIO production practices—now using `/data1`, `/data2`, … paths and including a universal host configuration checklist (hostnames, users, firewall, etc.).*

> **Reference topology** (adjust as needed):  
> 4 storage nodes (`10.10.13.51–54`) + 1 load balancer (`10.10.13.55`).  
> Each storage node has 4 XFS volumes mounted at `/data1`, `/data2`, `/data3`, `/data4`.

---

## Table of Contents
- [MinIO on Docker Swarm — Production Guide](#minio-on-docker-swarm--production-guide)
- [Production-Ready MinIO on Docker Swarm (Distributed / Multi-Node)](#production-ready-minio-on-docker-swarm-distributed--multi-node)
  - [Table of Contents](#table-of-contents)
  - [Architecture Overview](#architecture-overview)
  - [Global Host Configuration (All Nodes)](#global-host-configuration-all-nodes)
    - [1) Set hostnames (consistent naming)](#1-set-hostnames-consistent-naming)
    - [2) Hostname resolution](#2-hostname-resolution)
    - [3) Create a system group/user (optional but recommended for directory ownership)](#3-create-a-system-groupuser-optional-but-recommended-for-directory-ownership)
    - [4) Time sync, firewall, performance profile (RHEL/Alma Linux example)](#4-time-sync-firewall-performance-profile-rhelalma-linux-example)
    - [5) Open required ports (between nodes and LB)](#5-open-required-ports-between-nodes-and-lb)
    - [6) SELinux (if enforcing)](#6-selinux-if-enforcing)
  - [Requirements \& Sizing](#requirements--sizing)
  - [Prepare Disks (XFS) and Mounts `/data1..4`](#prepare-disks-xfs-and-mounts-data14)
  - [Install Docker \& Initialize Swarm](#install-docker--initialize-swarm)
  - [Node Labels \& Overlay Network](#node-labels--overlay-network)
  - [Secrets (Root Credentials)](#secrets-root-credentials)
  - [Deploy the Cluster (`docker-stack.yml`)](#deploy-the-cluster-docker-stackyml)
  - [Load Balancer (NGINX)](#load-balancer-nginx)
  - [First Login, Users \& Policies (`mc`)](#first-login-users--policies-mc)
  - [Health, Readiness \& Observability](#health-readiness--observability)
  - [Upgrades (Zero-Downtime) \& Rolling Updates](#upgrades-zero-downtime--rolling-updates)
  - [Capacity Expansion: Add a New Server Pool](#capacity-expansion-add-a-new-server-pool)
  - [Security Hardening Checklist](#security-hardening-checklist)
  - [Troubleshooting](#troubleshooting)
  - [Appendix: Handy Commands](#appendix-handy-commands)
    - [Change Log](#change-log)
  - [JSON-LD (Structured Data)](#json-ld-structured-data)

---

## Architecture Overview
- **Distributed MinIO** across nodes and disks with erasure coding. You’ll deploy **one service per node** (`minio1..minio4`) for stable addressing and easier ops.  
- **Server pools** support online capacity expansion; plan consistent disk sizes within a pool.  
- An external **L4/L7 load balancer** (NGINX shown) fronts S3 API (port 9000) and the Console (port 9001).

---

## Global Host Configuration (All Nodes)
Do this on **every storage node** and the **load balancer** before deploying.

### 1) Set hostnames (consistent naming)
On each node:
```bash
# Replace N with 1..4 on storage nodes; use "minio-lb" on the balancer
sudo hostnamectl set-hostname minioN
```

### 2) Hostname resolution
Create a shared mapping (use your real IPs):
```bash
cat <<'EOF' | sudo tee -a /etc/hosts
10.10.13.51  minio1
10.10.13.52  minio2
10.10.13.53  minio3
10.10.13.54  minio4
10.10.13.55  minio-lb
EOF
```

### 3) Create a system group/user (optional but recommended for directory ownership)
```bash
# A local OS user/group to own the data mountpoints on the host:
sudo groupadd --system minio || true
sudo useradd  --system --no-create-home --shell /sbin/nologin --gid minio minio || true
```

> **Note**: The Dockerized MinIO process must be able to read/write `/data*`. Owning these paths by the `minio` group (or `root`) is fine; just ensure permissions allow read/write for the container. If you run SELinux enforcing, set contexts (see below).

### 4) Time sync, firewall, performance profile (RHEL/Alma Linux example)
```bash
sudo dnf -y install chrony firewalld tuned policycoreutils-python-utils setools-console jq
sudo systemctl enable --now chronyd firewalld
sudo tuned-adm profile throughput-performance
```

### 5) Open required ports (between nodes and LB)
```bash
# Allow 9000 (S3) & 9001 (Console) from cluster + LB
for SRC in 10.10.13.51 10.10.13.52 10.10.13.53 10.10.13.54 10.10.13.55; do
  sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address='${SRC}' port port='9000' protocol='tcp' accept"
  sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address='${SRC}' port port='9001' protocol='tcp' accept"
done
sudo firewall-cmd --reload
```

### 6) SELinux (if enforcing)
```bash
# Allow containers to use /data1..4
sudo semanage fcontext -a -t container_file_t '/data[1-4](/.*)?'
sudo restorecon -Rv /data1 /data2 /data3 /data4
```

---

## Requirements & Sizing
- **Filesystem**: XFS is the recommended FS for MinIO production.  
- **Disks**: One mount per disk (`/data1`, `/data2`, `/data3`, `/data4`)—no nested directories.  
- **Consistency**: Keep drive sizes/types consistent **within a pool** to avoid reduced erasure-coding efficiency.  
- **Network**: Low latency between nodes; 10GbE (or better) is ideal.

---

## Prepare Disks (XFS) and Mounts `/data1..4`
Example for 4 drives per node (`/dev/sdb..sde`):
```bash
# Partition & format
for d in /dev/sdb /dev/sdc /dev/sdd /dev/sde; do
  sudo parted -s "$d" mklabel gpt mkpart xfs 1MiB 100%
  sudo mkfs.xfs -f "${d}1"
done

# Create mountpoints
sudo mkdir -p /data1 /data2 /data3 /data4

# Add to /etc/fstab (adjust device names if needed)
echo "/dev/sdb1 /data1 xfs defaults 0 0" | sudo tee -a /etc/fstab
echo "/dev/sdc1 /data2 xfs defaults 0 0" | sudo tee -a /etc/fstab
echo "/dev/sdd1 /data3 xfs defaults 0 0" | sudo tee -a /etc/fstab
echo "/dev/sde1 /data4 xfs defaults 0 0" | sudo tee -a /etc/fstab

# Mount and set ownership/permissions
sudo systemctl daemon-reload && sudo mount -a
sudo chgrp minio /data1 /data2 /data3 /data4 || true
sudo chmod 770  /data1 /data2 /data3 /data4
```

> If you run **rootless Docker** or custom user mappings, ensure the container UID/GID can write these paths (adjust ownership accordingly).

---

## Install Docker & Initialize Swarm
```bash
# Install Docker Engine via your distro method.
# Initialize on the manager:
sudo docker swarm init --advertise-addr <manager-ip>

# On each worker node:
sudo docker swarm join --token <token-from-init> <manager-ip>:2377
```

---

## Node Labels & Overlay Network
Label each node so one MinIO service lands on it:
```bash
sudo docker node update --label-add minio.id=1 --label-add minio.pool=1 <node-1-name>
sudo docker node update --label-add minio.id=2 --label-add minio.pool=1 <node-2-name>
sudo docker node update --label-add minio.id=3 --label-add minio.pool=1 <node-3-name>
sudo docker node update --label-add minio.id=4 --label-add minio.pool=1 <node-4-name>
```

Create an attachable overlay network (optionally encrypted—benchmark first):
```bash
sudo docker network create   --driver overlay   --attachable   # --opt encrypted   minio_net
```

---

## Secrets (Root Credentials)
Use Swarm **secrets** and MinIO’s `_FILE` env variants:
```bash
printf '%s' 'CHANGE_ME_MINIO_ROOT_USER'     | sudo docker secret create minio_root_user -
printf '%s' 'CHANGE_ME_MINIO_ROOT_PASSWORD' | sudo docker secret create minio_root_password -
```

---

## Deploy the Cluster (`docker-stack.yml`)
> Save as `docker-stack.yml`, then:  
> `sudo docker stack deploy -c docker-stack.yml minio`

```yaml
version: "3.9"

x-minio-common: &minio-common
  image: quay.io/minio/minio:RELEASE.YYYY-MM-DDThh-mm-ssZ  # Pin a specific release
  networks: [minio_net]
  environment:
    MINIO_ROOT_USER_FILE:     /run/secrets/minio_root_user
    MINIO_ROOT_PASSWORD_FILE: /run/secrets/minio_root_password
  secrets:
    - minio_root_user
    - minio_root_password
  ulimits:
    nofile:
      soft: 65536
      hard: 65536
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
    interval: 30s
    timeout: 20s
    retries: 3
  # Cluster spans 4 nodes × 4 disks per node
  command: >
    server --console-address ":9001"
    http://minio{1...4}/data{1...4}

services:
  minio1:
    <<: *minio-common
    hostname: minio1
    volumes:
      - /data1:/data1
      - /data2:/data2
      - /data3:/data3
      - /data4:/data4
    deploy:
      placement:
        constraints:
          - node.labels.minio.id == 1
      update_config:
        parallelism: 1
        order: start-first

  minio2:
    <<: *minio-common
    hostname: minio2
    volumes:
      - /data1:/data1
      - /data2:/data2
      - /data3:/data3
      - /data4:/data4
    deploy:
      placement:
        constraints:
          - node.labels.minio.id == 2
      update_config:
        parallelism: 1
        order: start-first

  minio3:
    <<: *minio-common
    hostname: minio3
    volumes:
      - /data1:/data1
      - /data2:/data2
      - /data3:/data3
      - /data4:/data4
    deploy:
      placement:
        constraints:
          - node.labels.minio.id == 3
      update_config:
        parallelism: 1
        order: start-first

  minio4:
    <<: *minio-common
    hostname: minio4
    volumes:
      - /data1:/data1
      - /data2:/data2
      - /data3:/data3
      - /data4:/data4
    deploy:
      placement:
        constraints:
          - node.labels.minio.id == 4
      update_config:
        parallelism: 1
        order: start-first

networks:
  minio_net:
    external: true

secrets:
  minio_root_user:
    external: true
  minio_root_password:
    external: true
```

**Why this layout?**  
- The `command` enumerates all nodes and disks: `http://minio{1...4}/data{1...4}`.  
- One service per node ensures stable names (`minio1..4`), simplifies ops, and supports adding a **Pool 2** later (`minio5..8`) without redesign.

---

## Load Balancer (NGINX)
Expose S3 at `/` and Console at `/minio/ui` (or use a dedicated subdomain for the Console).

```nginx
upstream minio_s3 {
  least_conn;
  server minio1:9000; server minio2:9000; server minio3:9000; server minio4:9000;
}
upstream minio_console {
  least_conn;
  server minio1:9001; server minio2:9001; server minio3:9001; server minio4:9001;
}

server {
  listen 443 ssl http2;
  server_name minio.example.net;

  # ssl_certificate     /etc/letsencrypt/live/minio.example.net/fullchain.pem;
  # ssl_certificate_key /etc/letsencrypt/live/minio.example.net/privkey.pem;

  client_max_body_size 0;
  proxy_buffering off; proxy_request_buffering off;

  location / {
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    chunked_transfer_encoding off;
    proxy_pass http://minio_s3;
  }

  location /minio/ui/ {
    rewrite ^/minio/ui/(.*) /$1 break;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    chunked_transfer_encoding off;
    proxy_pass http://minio_console;
  }
}
```

Set for your services:
```bash
# Console redirect when proxied under /minio/ui
export MINIO_BROWSER_REDIRECT_URL="https://minio.example.net/minio/ui"
```

---

## First Login, Users & Policies (`mc`)
```bash
# Point MinIO Client to your LB endpoint
mc alias set s3 https://minio.example.net   "$(sudo docker secret inspect --format '{{index .Spec.Data}}' minio_root_user | base64 -d)"   "$(sudo docker secret inspect --format '{{index .Spec.Data}}' minio_root_password | base64 -d)"

mc admin info s3
mc mb s3/boot-bucket

# Create least-privilege app users & attach policies
mc admin user add s3 app-user APP-SECRET
mc admin policy attach s3 readwrite --user app-user
```

---

## Health, Readiness & Observability
- Health endpoints:  
  - Liveness: `GET /minio/health/live`  
  - Readiness: `GET /minio/health/ready`  
  - Cluster: `GET /minio/health/cluster`  
- Metrics: scrape Prometheus targets at `/minio/v2/metrics/cluster` (and node metrics if desired).  
- Consider `mc admin prometheus generate` to bootstrap target lists.

---

## Upgrades (Zero-Downtime) & Rolling Updates
- Pin a specific MinIO release tag in `docker-stack.yml`.  
- To upgrade, change the image tag and redeploy the stack:
  ```bash
  sudo docker stack deploy -c docker-stack.yml minio
  ```
- Services restart in place; S3 clients retry seamlessly in most cases.

---

## Capacity Expansion: Add a New Server Pool
Add nodes `minio5..minio8` with their own `/data1..4`. Update the **same** `server` command on **all** services to include both pools, e.g.:
```
server --console-address ":9001"   http://minio{1...4}/data{1...4}   http://minio{5...8}/data{1...4}
```
Then roll the stack so every service picks up the expanded endpoint list.

---

## Security Hardening Checklist
- **TLS everywhere** (LB and/or node).  
- **Secrets** for root credentials (`*_FILE` env).  
- **Least privilege** app users & bucket policies—never use root creds in apps.  
- **Filesystem**: XFS, consistent disk sizes within a pool, one mount per disk.  
- **Overlay encryption**: optional; validate impact in staging before enabling.  
- **ulimits**: raise `nofile` (e.g., 65k) if you expect high concurrency.  
- **Firewall & SELinux**: restrict ingress, set proper SELinux contexts on `/data*`.  

---

## Troubleshooting
- **A node doesn’t join the cluster**: all services must list the same endpoints; check DNS (`/etc/hosts`) and `command` strings.  
- **Permission denied on `/data*`**: verify ownership/permissions and SELinux context; ensure the container UID can write.  
- **LB 502/504 or Console errors**: confirm upstreams are healthy, keep-alives enabled, and `MINIO_BROWSER_REDIRECT_URL` is set correctly.  
- **Drive replaced**: mount it at the same path (`/dataX`), fix ownership/labels, then `mc admin heal -r`.

---

## Appendix: Handy Commands
```bash
# Swarm status
docker node ls
docker service ls
docker service ps minio_minio1

# Network
docker network inspect minio_net

# Cluster
mc admin info s3
mc admin top locks s3
mc admin heal -r s3
```

---

### Change Log
- Paths updated from `/mnt/minio/export{1..4}` to **`/data{1..4}`** everywhere (mounts, volumes, and `server` command).  
- Added **Global Host Configuration** with hostnames, `/etc/hosts`, system user/group, chrony, firewalld, tuned, and SELinux guidance.  
- Examples revised to reduce ambiguity and make node prep reproducible.


## JSON-LD (Structured Data)
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "headline": "MinIO on Docker Swarm — Production Guide",
  "description": "Distributed, S3-compatible object storage on Docker Swarm with XFS, erasure coding, NGINX, secrets, health checks, metrics, and zero-downtime upgrades.",
  "about": ["MinIO", "Docker Swarm", "Object Storage", "S3 compatibility", "DevOps"],
  "inLanguage": "en",
  "license": "https://www.apache.org/licenses/LICENSE-2.0",
  "creator": {
    "@type": "Person",
    "name": "Miguel Saca"
  }
}
</script>
