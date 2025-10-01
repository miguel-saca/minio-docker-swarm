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
    - [1) Update All Packages](#1-update-all-packages)
    - [2) Set hostnames (consistent naming)](#2-set-hostnames-consistent-naming)
    - [3) Hostname resolution](#3-hostname-resolution)
    - [4) Create a system group/user (optional but recommended for directory ownership)](#4-create-a-system-groupuser-optional-but-recommended-for-directory-ownership)
    - [5) Time sync, firewall, performance profile (RHEL/Alma Linux example)](#5-time-sync-firewall-performance-profile-rhelalma-linux-example)
    - [6) Configure Firewall (Docker Swarm & MinIO)](#6-configure-firewall-docker-swarm--minio)
    - [7) SELinux (if enforcing)](#7-selinux-if-enforcing)
  - [Requirements \& Sizing](#requirements--sizing)
  - [Prepare Disks (XFS) and Mounts `/data1..4`](#prepare-disks-xfs-and-mounts-data14)
  - [Install Docker \& Initialize Swarm](#install-docker--initialize-swarm)
  - [Node Labels \& Overlay Network](#node-labels--overlay-network)
  - [Secrets (Root Credentials)](#secrets-root-credentials)
  - [Deploy the Cluster (`minio-stack.yml`)](#deploy-the-cluster-minio-stackyml)
  - [Load Balancer Node Setup (NGINX)](#load-balancer-node-setup-nginx)
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

### 1) Update All Packages
First, ensure all system packages are up-to-date. This minimizes potential conflicts and security vulnerabilities.

```bash
sudo dnf upgrade -y
```

### 2) Set hostnames (consistent naming)
On each node:
```bash
# Replace N with 1..4 on storage nodes; use "minio-lb" on the balancer
sudo hostnamectl set-hostname minioN
```

### 3) Hostname resolution
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

### 4) Create a system group/user (optional but recommended for directory ownership)
```bash
# A local OS user/group to own the data mountpoints on the host:
sudo groupadd --system minio || true
sudo useradd  --system --no-create-home --shell /sbin/nologin --gid minio minio || true
```

> **Note**: The Dockerized MinIO process must be able to read/write `/data*`. Owning these paths by the `minio` group (or `root`) is fine; just ensure permissions allow read/write for the container. If you run SELinux enforcing, set contexts (see below).

### 5) Time sync, firewall, performance profile (RHEL/Alma Linux example)
```bash
sudo dnf -y install chrony firewalld tuned policycoreutils-python-utils setools-console jq
sudo systemctl enable --now chronyd firewalld
sudo tuned-adm profile throughput-performance
```

### 6) Configure Firewall (Docker Swarm & MinIO)

These rules cover both **Docker Swarm** communication and **MinIO** application traffic. The source `10.10.13.0/24` should match your node subnet.

```bash
# --- Docker Swarm Communication ---

# Manager node only (e.g., host ending in .51)
sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address='10.10.13.0/24' port port='2377' protocol='tcp' accept"
sudo firewall-cmd --permanent --add-rich-rule="rule protocol value='esp' accept"

# All nodes except LB
sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address='10.10.13.0/24' port port='7946' protocol='tcp' accept"
sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address='10.10.13.0/24' port port='7946' protocol='udp' accept"
sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address='10.10.13.0/24' port port='4789' protocol='udp' accept"

# --- MinIO Application Ports ---

# All storage nodes: Allow 9000 (S3) & 9001 (Console) from cluster + LB
for SRC in 10.10.13.51 10.10.13.52 10.10.13.53 10.10.13.54 10.10.13.55; do
  sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address='${SRC}' port port='9000' protocol='tcp' accept"
  sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address='${SRC}' port port='9001' protocol='tcp' accept"
done

# --- Apply All Rules ---
sudo firewall-cmd --reload
```

### 7) SELinux (if enforcing)
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

These steps should be performed on all storage nodes (`minio1..4`).

### 1) Create Sudo-Enabled Admin User

First, create a dedicated user for administration on each storage node. This user will run `docker` commands without needing to be `root`.

```bash
# Replace 'user-minio-01' with your desired username for each node
adduser user-minio-01
passwd user-minio-01

# Add the user to the 'wheel' group for sudo privileges
usermod -aG wheel user-minio-01
```

### 2) Install Docker Engine

Next, install Docker Engine using the official repositories. This ensures you get the latest stable version.

```bash
# Remove any old Docker versions (optional but recommended)
sudo dnf -y remove docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine || true

# Add the Docker CE repository
sudo dnf install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# Install Docker packages
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Enable and start the Docker service
sudo systemctl enable --now docker
sudo systemctl status docker

# Add your admin user to the 'docker' group to run Docker commands without sudo
# Replace 'user-minio-01' with the username you created
sudo usermod -aG docker user-minio-01

# A reboot is required for the group changes to take full effect
echo "Reboot required. Please run 'sudo reboot' and log back in as the new user."
```

<div class="alert warning">
<p><strong>Important:</strong> After rebooting, log in as the new user (e.g., <code>user-minio-01</code>) for all subsequent steps. You should be able to run <code>docker</code> commands without <code>sudo</code>.</p>
</div>

### 3) Initialize Swarm

Once Docker is running on all nodes, initialize the Swarm on your designated manager node and join the workers.

```bash
# On the manager node (e.g., minio1):
docker swarm init --advertise-addr <manager-ip>

# On each worker node (e.g., minio2, minio3, minio4):
docker swarm join --token <token-from-init> <manager-ip>:2377
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

Create the root user and password as Docker secrets. This command should be run **only on a manager node**. It uses `read -s` to prompt for credentials without saving them to your shell history.

```bash
# Interactively and securely create secrets
read -rsp "MINIO_ROOT_USER: " MINIO_ROOT_USER; echo
read -rsp "MINIO_ROOT_PASSWORD: " MINIO_ROOT_PASSWORD; echo

# Create Docker secrets from the variables
printf '%s' "$MINIO_ROOT_USER"     | sudo docker secret create minio_root_user -
printf '%s' "$MINIO_ROOT_PASSWORD" | sudo docker secret create minio_root_password -

# Unset the variables to remove them from the shell session
unset MINIO_ROOT_USER MINIO_ROOT_PASSWORD
```

---

## Deploy the Cluster (`minio-stack.yml`)

On the **manager node only**, create a dedicated directory to store the stack manifest. This keeps your configuration organized and secure.

```bash
sudo mkdir -p /opt/minio
sudo chown -R user-minio-01:user-minio-01 /opt/minio
sudo chmod 700 /opt/minio
```

Now, save the following content as `/opt/minio/minio-stack.yml`.

> **Deploy command:**
> `sudo docker stack deploy -c /opt/minio/minio-stack.yml minio`

```yaml
version: "3.9"

x-minio-common: &minio-common
  image: quay.io/minio/minio:RELEASE.YYYY-MM-DDThh-mm-ssZ
  networks: [minio_net]
  environment:
    # URL S3 Public (for clients and pre-signed URLs)
    MINIO_SERVER_URL: "https://example.com/minio/s3/"
    # URL console public
    MINIO_BROWSER_REDIRECT_URL: "https://example.com/minio/ui/"
    MINIO_ROOT_USER_FILE: /run/secrets/minio_root_user
    MINIO_ROOT_PASSWORD_FILE: /run/secrets/minio_root_password
  secrets:
    - minio_root_user
    - minio_root_password
  ulimits:
    nofile: { soft: 65536, hard: 65536 }
  stop_grace_period: 1m
  healthcheck:
    test: ["CMD-SHELL", "curl -fsS 'http://localhost:9000/minio/health/live' || exit 1"]
    interval: 30s
    timeout: 10s
    retries: 3
  command: >
    minio server --console-address ":9001"
    http://minio{1...4}/data{1...4}
  volumes:
    - /data1:/data1
    - /data2:/data2
    - /data3:/data3
    - /data4:/data4
  ports:
    - target: 9000
      published: 9000
      protocol: tcp
      mode: host
    - target: 9001
      published: 9001
      protocol: tcp
      mode: host


services:
  minio1:
    <<: *minio-common
    hostname: minio1
    deploy:
      placement:
        constraints: [ "node.labels.minio.id == 1" ]
      restart_policy: { condition: any, delay: 5s }
      update_config: { parallelism: 1, order: stop-first, failure_action: rollback }


  minio2:
    <<: *minio-common
    hostname: minio2
    deploy:
      placement:
        constraints: [ "node.labels.minio.id == 2" ]
      restart_policy: { condition: any, delay: 5s }
      update_config: { parallelism: 1, order: stop-first, failure_action: rollback }


  minio3:
    <<: *minio-common
    hostname: minio3
    deploy:
      placement:
        constraints: [ "node.labels.minio.id == 3" ]
      restart_policy: { condition: any, delay: 5s }
      update_config: { parallelism: 1, order: stop-first, failure_action: rollback }


  minio4:
    <<: *minio-common
    hostname: minio4
    deploy:
      placement:
        constraints: [ "node.labels.minio.id == 4" ]
      restart_policy: { condition: any, delay: 5s }
      update_config: { parallelism: 1, order: stop-first, failure_action: rollback }


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

## Load Balancer Node Setup (NGINX)

These steps apply **only to the Load Balancer (LB) node**.

### 1) Install NGINX & Configure SELinux

Install NGINX and allow it to make network connections, which is required for proxying traffic to the MinIO backend.

```bash
sudo dnf -y install nginx
sudo setsebool -P httpd_can_network_connect 1
```

### 2) Open Firewall Ports

Allow public traffic on standard HTTP and HTTPS ports.

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 3) Create Admin User & Set Hostname

Set a unique hostname and create a dedicated admin user for the LB node.

```bash
sudo hostnamectl set-hostname minio-lb
adduser user-minio-lb
passwd user-minio-lb
usermod -aG wheel user-minio-lb
```

### 4) TLS Certificate Setup

Choose one of the following two options to secure your NGINX proxy.

#### Option A: Let's Encrypt with Certbot (Recommended)

This is the preferred method for obtaining and managing free, trusted TLS certificates.

```bash
# Install Certbot for NGINX
sudo dnf -y install certbot python3-certbot-nginx

# Obtain and install a certificate (this will also update your NGINX config)
sudo certbot --nginx -d minio.example.com
```

#### Option B: Manual Certificate Installation

Use this method if you have a commercial or self-signed certificate. Place your certificate and private key in the specified directory.

```bash
# Create a directory for TLS certificates
sudo mkdir -p /etc/nginx/tls

# Set secure ownership and permissions
sudo chown root:nginx /etc/nginx/tls
sudo chmod 750 /etc/nginx/tls

# Copy your certificate and key, then set permissions
# sudo cp /path/to/your/fullchain.pem /etc/nginx/tls/
# sudo cp /path/to/your/privkey.pem /etc/nginx/tls/
sudo chown root:nginx /etc/nginx/tls/*
sudo chmod 640 /etc/nginx/tls/*
```

---

## Load Balancer (NGINX)
Expose S3 at `/` and Console at `/minio/ui` (or use a dedicated subdomain for the Console).

```nginx
# ─────────── Global Directives ───────────
# For WebSocket support
map $http_upgrade $connection_upgrade { 
    default upgrade; 
    ''      close; 
}

# Allow underscores in headers for S3 compatibility
underscores_in_headers on;

# ─────────── Upstreams ───────────
upstream minio_s3 {
    least_conn;
    server minio1:9000 max_fails=3 fail_timeout=10s;
    server minio2:9000 max_fails=3 fail_timeout=10s;
    server minio3:9000 max_fails=3 fail_timeout=10s;
    server minio4:9000 max_fails=3 fail_timeout=10s;
    keepalive 64;
}

upstream minio_console {
    least_conn;
    server minio1:9001 max_fails=3 fail_timeout=10s;
    server minio2:9001 max_fails=3 fail_timeout=10s;
    server minio3:9001 max_fails=3 fail_timeout=10s;
    server minio4:9001 max_fails=3 fail_timeout=10s;
    keepalive 32;
}

# ─────────── HTTP → HTTPS ───────────
server {
    listen 80;
    listen [::]:80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

# ─────────── HTTPS Server ───────────
server {
    listen 443 ssl http2;
    server_name minio.example.com;

    # ssl_certificate     /etc/letsencrypt/live/minio.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/minio.example.net/privkey.pem;

    client_max_body_size 0;
    proxy_buffering off;
    proxy_request_buffering off;

    location /minio/s3/ {
        rewrite ^/minio/s3/(.*) /$1 break;
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
        proxy_set_header Connection $connection_upgrade;
        chunked_transfer_encoding off;
        proxy_pass http://minio_console;
    }

    location / {
        return 308 /minio/ui/;  # Use 302 if you prefer temporary during testing.
    }
}
```

Set for your services:
```bash
# Console redirect when proxied under /minio/ui
export MINIO_BROWSER_REDIRECT_URL="https://minio.example.net/minio/ui"
```

---

## Connecting and Managing with MinIO Client (`mc`)

The MinIO Client (`mc`) is the recommended tool for administering your cluster. The following steps show how to run `mc` via a Docker container, ensuring a consistent environment.

### 1. Set Up `mc` via Docker

First, create a persistent volume for the `mc` configuration and launch a container with an interactive shell. This setup can be done on any host with Docker that can reach the cluster (either a cluster node or an external machine).

```bash
# 1) (One-time only) Create a volume for mc config
docker volume create mc-config

# 2) Open a shell inside the mc container
#    --network host is used for easy access when running on a cluster node
docker run --rm -it --network host -v mc-config:/root/.mc --entrypoint sh --name mc-shell quay.io/minio/mc
```

> **Note:** All subsequent `mc` commands are run inside this container's shell.

### 2. Configure a Cluster Alias

Next, create an alias to connect to your MinIO cluster. An alias is a nickname for a MinIO deployment, storing its URL and credentials.

```bash
# Get root credentials from Docker secrets (run this on a manager node)
MINIO_ROOT_USER=$(sudo docker secret inspect --format '{{.Spec.Data}}' minio_root_user | base64 -d)
MINIO_ROOT_PASSWORD=$(sudo docker secret inspect --format '{{.Spec.Data}}' minio_root_password | base64 -d)

# Create the alias inside the mc container
# Option A: From an external host (points to the NGINX proxy)
mc alias set myminio https://example.com/minio/s3/ "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --api "s3v4"

# Option B: From a node within the cluster (points directly to a MinIO service)
mc alias set myminio http://minio1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
```

### 3. Example Workflow: Create a Bucket, User, and Policy

This workflow demonstrates how to create a dedicated user with access restricted to a single bucket.

#### Step 1: Create a Bucket

```bash
# Create a new bucket named 'test-bucket'
mc mb myminio/test-bucket

# Verify the bucket was created
mc ls myminio
```

#### Step 2: Create a Read/Write Policy

Create a JSON file with a policy that grants full access (`s3:*`) but only to `test-bucket`.

```bash
# Inside the mc container, create the policy file
cat <<'EOF' > /tmp/test-bucket-policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": ["s3:*"],
            "Resource": ["arn:aws:s3:::test-bucket/*"]
        }
    ]
}
EOF

# Add the new policy to MinIO
mc admin policy add myminio test-bucket-policy /tmp/test-bucket-policy.json
```

#### Step 3: Create a User and Attach the Policy

Now, create a new user and assign the policy you just created.

```bash
# Create a new user named 'user.test' with a secure password
mc admin user add myminio user.test 'YOUR_SECURE_PASSWORD_HERE'

# Attach the bucket-specific policy to the new user
mc admin policy attach myminio test-bucket-policy --user user.test
```

#### Step 4: Generate a Service Account for Application Use

For applications, it is best practice to use service accounts, which are long-lived credentials tied to a user. The user `user.test` can create a service account for themselves.

```bash
# First, create an alias for the new user
mc alias set testuser https://example.com/minio/s3/ user.test 'YOUR_SECURE_PASSWORD_HERE' --api "s3v4"

# Now, as 'testuser', create a service account
mc admin user svcacct add --access-key 'app.test.access.key' --secret-key 'app.test.secret.key' testuser user.test
```

The generated `Access Key` and `Secret Key` can now be used in your application's S3 client configuration to interact with `test-bucket`.

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
- Pin a specific MinIO release tag in `/opt/minio/minio-stack.yml`.  
- To upgrade, change the image tag and redeploy the stack:
  ```bash
  sudo docker stack deploy -c /opt/minio/minio-stack.yml minio
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
