# Guestbook monitoring stack

Pulumi TypeScript program that deploys nginx (frontend), Redis with a metrics exporter, and kube-prometheus-stack (Grafana / Prometheus) onto a local Kubernetes cluster.

## Prerequisites

- Docker Desktop with Kubernetes enabled (cluster type: **kind**, managed by Docker Desktop), or an Ubuntu server where you install Docker and `kind` yourself (see [Alternative setup](#alternative-setup-ubuntu-server-ec2-with-kind)). Give the cluster at least 6 GB RAM (Docker Desktop: Settings → Resources); pods stay `Pending` if there is too little.
- `kubectl`
- Node.js and npm
- Pulumi CLI
- `helm` (optional, only needed to inspect or uninstall releases manually)

> **Docker Desktop path: no `kind` CLI needed.** Docker Desktop creates and manages the cluster itself, so commands like `kind create cluster` are not used. Running `kind` on its own gives `zsh: command not found: kind`, which is expected and harmless here.

## Install Pulumi

**macOS (Homebrew):**

```bash
brew install pulumi/tap/pulumi
```

**macOS (install script, if you don't use Homebrew):**

```bash
curl -fsSL https://get.pulumi.com | sh
```

The script installs Pulumi to `~/.pulumi/bin`. If the shell later says `command not found: pulumi`, add that folder to your PATH and reload zsh:

```bash
echo 'export PATH=$PATH:$HOME/.pulumi/bin' >> ~/.zshrc
source ~/.zshrc
```

Verify the install (open a new terminal window if it isn't found):

```bash
pulumi version
```

Pulumi's TypeScript programs also need Node.js. Check it with `node --version`. The Kubernetes provider packages are installed later by `npm install`, so there is nothing else to install for Pulumi itself.

## Alternative setup: Ubuntu server (EC2) with kind

Use this path if you are deploying on a headless Ubuntu server (for example an AWS EC2 instance) instead of Docker Desktop. Here you install Docker, `kind` and the other tools yourself.

### 1. Base packages and Docker Engine

```bash
sudo apt-get update
sudo apt-get install -y curl git ca-certificates

# Docker's convenience script: https://docs.docker.com/engine/install/ubuntu/
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker                      # or log out and back in
docker run --rm hello-world        # should print "Hello from Docker!"
```

### 2. kubectl

```bash
# https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl
rm kubectl
kubectl version --client
```

### 3. kind

```bash
# https://kind.sigs.k8s.io/docs/user/quick-start/ (fetches the latest release tag)
KIND_VERSION=$(curl -s https://api.github.com/repos/kubernetes-sigs/kind/releases/latest | grep '"tag_name"' | cut -d '"' -f4)
echo "$KIND_VERSION"               # sanity check: should look like v0.x.y
curl -Lo ./kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64"
sudo install -m 0755 kind /usr/local/bin/kind
rm kind
kind version
```

### 4. Raise inotify limits

Recommended before running a monitoring stack on kind. The values below come from kind's known-issues page and avoid "too many open files" errors in pods (check https://kind.sigs.k8s.io/docs/user/known-issues/ if they change).

```bash
sudo sysctl fs.inotify.max_user_watches=524288
sudo sysctl fs.inotify.max_user_instances=512
# make it permanent:
echo -e "fs.inotify.max_user_watches=524288\nfs.inotify.max_user_instances=512" | sudo tee /etc/sysctl.d/99-kind.conf
```

### 5. Node.js (LTS)

Ubuntu's own `nodejs` package is often too old, so this uses NodeSource. If the script URL returns a 404, check https://github.com/nodesource/distributions for the current script name.

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version && npm --version
```

### 6. Pulumi

```bash
# https://www.pulumi.com/docs/iac/download-install/
curl -fsSL https://get.pulumi.com | sh
echo 'export PATH=$PATH:$HOME/.pulumi/bin' >> ~/.bashrc
source ~/.bashrc
pulumi version
```

### 7. Helm (optional, only for inspecting or uninstalling releases)

```bash
# https://helm.sh/docs/intro/install/ (check this page for the current script name if Helm 4 is out)
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
helm version
```

## Create the cluster

**Docker Desktop:** nothing to run. Enable Kubernetes in Docker Desktop's settings.

**Remote server with kind installed:**

```bash
kind create cluster --name guestbook
```

## Deploy

### 1. Point kubectl at the cluster

Pulumi deploys to whichever kubectl context is currently selected, so check this first.

**Using Docker Desktop:**

```bash
kubectl config get-contexts
kubectl config use-context docker-desktop
kubectl get nodes          # should show one node, Ready
```

**Using kind:**

```bash
kind create cluster --name guestbook
kubectl config use-context kind-guestbook
kubectl get nodes          # should show one node, Ready
```

### 2. Create the Pulumi stack

A **project** is the code folder (`k8s-guestbook`). A **stack** is one deployed instance of it (here, `dev`). A project with no stack cannot be deployed.

First get the code. 

```bash
git clone https://github.com/CloudNativeForge/k8s-guestbook
cd ~/k8s-guestbook/
git init
```

Confirm you are in the project folder:

```bash
ls Pulumi.yaml
```

Pulumi needs a backend to store the stack's state. Pick one:

**Option A: Pulumi Cloud** (the default; state is stored online, no passphrase needed)

```bash
pulumi login              # opens a browser to sign in or create a free account
pulumi whoami -v          # confirm you are logged in
```

**Option B: Local state** (simplest for this assignment; state stays on your machine)

```bash
pulumi login --local
export PULUMI_CONFIG_PASSPHRASE=""    # or set a real passphrase
```

Then create the stack (the same for both options):

```bash
pulumi stack init dev
pulumi stack ls           # dev should have a * next to it
```

- If it says the stack already exists: `pulumi stack select dev`.
- With local state, the passphrase variable must be exported again in every new terminal. Add it to `~/.zshrc` (or `~/.bashrc` on Ubuntu) to avoid repeating this. Pulumi Cloud does not need it.

### 3. Set config

Config is stored per stack, so the stack must exist first.

```bash
pulumi config set grafanaAdminPassword 'ChangeMe123'
```

Add `--secret` to encrypt the value in the stack config.

The original Pulumi Guestbook example uses an `isMinikube` setting to switch its frontend from `LoadBalancer` to `ClusterIP`. It is only needed if you use that example's frontend code, and it works on kind and Docker Desktop too despite the name. This program uses a `NodePort` frontend, so the setting is not required.

### 4. Install dependencies and deploy

```bash
npm install
pulumi up                 # choose "yes" at the prompt
```

The first install of kube-prometheus-stack is large and can take several minutes. If `pulumi up` times out, run it again.

Wait for everything to be `Running`:

```bash
kubectl get pods
kubectl get pods -n monitoring
```

## Access the services

Neither Docker Desktop nor kind has a cloud load balancer, and the NodePorts are not published to your laptop. Use `kubectl port-forward` (each command keeps running, so use a separate terminal for each).

**Frontend:**

```bash
kubectl port-forward svc/frontend 8080:80
# open http://localhost:8080
```

**Grafana** (the Service is NodePort 30300 inside the cluster):

```bash
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
# open http://localhost:3000
```

**Prometheus:**

```bash
kubectl port-forward -n monitoring svc/monitoring-kube-prometheus-prometheus 9090:9090
# open http://localhost:9090
# scrape targets page: http://localhost:9090/targets
```

| Item           | URL                           |
| -------------- | ----------------------------- |
| Frontend       | http://localhost:8080         |
| Grafana        | http://localhost:3000         |
| Prometheus UI  | http://localhost:9090         |
| Scrape targets | http://localhost:9090/targets |

### On a remote server (EC2)

A server has no browser, so run the port-forwards above on the server (add `&` to run each in the background), then tunnel to them from your laptop over SSH. This is safer than exposing ports publicly.

```bash
curl -s localhost:8080 | head -5      # on the server: quick check the frontend answers
```

On your laptop:

```bash
ssh -L 8080:localhost:8080 -L 3000:localhost:3000 -L 9090:localhost:9090 user@your-server
```

Then open the `localhost` URLs from the table above in your laptop's browser.

> Avoid `kubectl port-forward --address 0.0.0.0` on a server with a public IP. It exposes Grafana and Prometheus to anyone who can reach that port.

### Grafana access details

| Item     | Value                                                              |
| -------- | ------------------------------------------------------------------ |
| URL      | http://localhost:3000 (requires the Grafana port-forward above)    |
| Username | `admin`                                                            |
| Password | value of `grafanaAdminPassword` (`ChangeMe123` on the `dev` stack) |

Read the password at any time with `pulumi config get grafanaAdminPassword`. The Pulumi stack also outputs the Grafana URL and credentials:

```bash
pulumi stack output
```

## Verify that metrics are being scraped

1. Start the Prometheus port-forward (above) and open the targets page: [http://localhost:9090/targets](http://localhost:9090/targets).
2. Find `serviceMonitor/monitoring/redis-leader`. It should show **UP**.
3. On the **Graph** page, run these queries:

| Query                                                         | What it shows                          |
| ------------------------------------------------------------- | -------------------------------------- |
| `redis_up`                                                    | `1` means the exporter can reach Redis |
| `redis_commands_processed_total`                              | Backend (Redis) request counter        |
| `rate(redis_commands_processed_total[1m])`                    | Redis commands per second              |
| `container_memory_working_set_bytes{pod=~"nginx.*"}`          | Frontend memory usage                  |
| `rate(container_cpu_usage_seconds_total{pod=~"nginx.*"}[1m])` | Frontend CPU usage                     |

If the target is missing or DOWN, see "Troubleshooting" below.

## What metrics are collected

- **Backend (Redis):** a `redis_exporter` sidecar in the Redis pod exposes application metrics on port 9121 (named port `metrics`). A ServiceMonitor tells Prometheus to scrape it.
- **Frontend (nginx):** the stock nginx image does not expose a `/metrics` endpoint. Its **resource usage** (CPU, memory, restarts) is collected automatically by the cAdvisor and kube-state-metrics components that ship with kube-prometheus-stack. No application-level request metrics are exposed for the frontend. The assignment accepts resource usage, and no fake metrics were added.

## Grafana dashboards

- The chart ships ready-made dashboards. Open **Dashboards** in Grafana and look for **Kubernetes / Compute Resources / Pod** to see frontend and Redis pod CPU and memory.
- **Stretch goal (optional):** create a dashboard with these panels, then export it as JSON (Dashboard settings → JSON Model) and commit it to the repo:
  - Redis commands per second: `rate(redis_commands_processed_total[1m])`
  - Frontend CPU: `rate(container_cpu_usage_seconds_total{pod=~"nginx.*"}[1m])`
  - Frontend memory: `container_memory_working_set_bytes{pod=~"nginx.*"}`

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `zsh: command not found: kind` | The `kind` CLI is not installed. It is not needed with Docker Desktop's Kubernetes, so skip any `kind` commands. On an Ubuntu server, follow the [kind install step](#3-kind). |
| `no Pulumi.yaml found` | You are not in the project folder. `cd ~/k8s-guestbook`. |
| Project exists but `pulumi stack ls` is empty | `pulumi new` creates the project but no stack. Log in to a backend, then run `pulumi stack init dev` (or `pulumi stack select dev` if it already exists). |
| Passphrase prompt on every Pulumi command | `export PULUMI_CONFIG_PASSPHRASE=""` (see Deploy, step 2). |
| `services "..." not found` | Either the app is not deployed (`pulumi up`), kubectl is on the wrong context (`kubectl config use-context docker-desktop` or `kind-guestbook`), or Pulumi autonaming added a random suffix. Run `kubectl get svc` (and `kubectl get svc -n monitoring`) to see the real names, and set `metadata.name` (or `name:` on the Helm release) explicitly. Search all namespaces with `kubectl get svc -A \| grep <name>`. |
| Pods stuck `Pending` | Raise Docker Desktop memory to 6 GB or more (Settings → Resources). On a server, use at least 4 vCPU and 16 GB RAM. |
| Pods fail with "too many open files" | Raise the inotify limits (Ubuntu setup, step 4). |
| ServiceMonitor creation fails | The Helm release has not finished installing, so the CRD does not exist yet. Make sure the ServiceMonitor has `dependsOn: [monitoring]`. |
| Target missing in Prometheus | The ServiceMonitor `matchLabels`, port name, or namespace does not match the Service. Check with `kubectl get svc redis-leader --show-labels`. |
| `localhost:3000` not reachable | The Grafana port-forward is not running (and, on a server, the SSH tunnel must be open too). |
| `pulumi up` hangs on a Service | A `LoadBalancer` Service never gets an external IP on a local cluster. Use `NodePort` or `ClusterIP`. |

## Issues we hit

### 1. Invalid `index.ts` (frontend Service nested in the nginx Deployment)

The frontend Service was pasted inside the nginx Deployment constructor. `frontendLabels` was undefined and the braces did not match, so TypeScript could not compile.

**Fix:** Close the Deployment, define `frontendLabels`, and declare the Service as its own resource with `metadata.name: "frontend"`.

### 2. `kubectl port-forward svc/frontend 8080:80`: Service not found

Pulumi's first `up` only created the nginx Deployment. There was no Service named `frontend` (only `kubernetes` in `default`). Port-forward failed with `services "frontend" not found`.

**Fix:** Create a NodePort Service named `frontend` whose selector matches the nginx pod labels (`app: nginx`).

### 3. Invalid Kubernetes name from Pulumi autonaming

A Deployment was created with a name that included a space (`nginx-d70eda1c -01901a4c`). Kubernetes rejected it (`metadata.name` must be a lowercase RFC 1123 subdomain).

**Fix:** Use a valid Pulumi resource name (no trailing spaces). Set `metadata.name` when you need a stable kubectl name instead of an autoname.

### 4. Helm release autoname vs fixed name `monitoring`

Without `name: "monitoring"` on `k8s.helm.v3.Release`, Helm installed the chart as `monitoring-8c3a3fbd`. That also changed the Service names, for example `monitoring-8c3a3fbd-kube-prometheus-prometheus` instead of `monitoring-kube-prometheus-prometheus`, so `kubectl port-forward` failed with `services "monitoring-kube-prometheus-prometheus" not found`. Adding `name: "monitoring"` later **renames** the Helm release. Helm cannot rename in place, so Pulumi tried to install a **second** kube-prometheus-stack.

That failed with **2 errored** resources because:

- Grafana NodePort **30300** was already taken by the old release
- node-exporter was **Pending** (host-port conflict with the old DaemonSet)
- cluster-scoped objects (webhooks, ClusterRoles, CRDs) already existed

Cluster state was two releases: `monitoring-8c3a3fbd` (deployed) and `monitoring` (failed).

**Fix:**

```bash
helm uninstall monitoring -n monitoring
helm uninstall monitoring-8c3a3fbd -n monitoring
pulumi refresh --yes
pulumi up --yes
```

Result: a single deployed release named `monitoring`, with predictable Service names (`monitoring-grafana`, `monitoring-kube-prometheus-prometheus`).

**Lesson:** set `name:` on the Helm release (and `metadata.name` on Services you will reference with kubectl) from the start.

### 5. Grafana URL vs NodePort

The stack exports `grafanaUrl = "http://localhost:3000"`, but Grafana is a NodePort on **30300**. `localhost:3000` only works with the port-forward described in "Access the services".

Docker Desktop's Kubernetes is kind-type but is not a cluster created with the `kind` CLI. A kind `extraPortMappings` entry (30300 → 3000) can only be set when a cluster is created with `kind create cluster --config`, which Docker Desktop does not allow.

### 6. Redis ServiceMonitor must match Service labels and namespaces

Prometheus lives in `monitoring`. Redis is in `default`. A ServiceMonitor in `monitoring` will not scrape Redis unless:

- The Service is labeled `app: redis-leader`
- It exposes a named port `metrics` on `9121`
- The ServiceMonitor uses `namespaceSelector.matchNames: ["default"]`
- It depends on the Helm release so the ServiceMonitor CRD exists first
- Prometheus is configured with `serviceMonitorSelectorNilUsesHelmValues: false`, so it also picks up ServiceMonitors that lack the Helm release label

## Current layout

| Resource             | Name               | Notes                           |
| -------------------- | ------------------ | ------------------------------- |
| Deployment + Service | nginx / `frontend` | NodePort 80                     |
| Deployment + Service | `redis-leader`     | Redis 6379 + exporter 9121      |
| Namespace            | `monitoring`       | kube-prometheus-stack           |
| Helm release         | `monitoring`       | Grafana NodePort 30300          |
| ServiceMonitor       | `redis-leader`     | scrapes `default` Redis metrics |

## Clean up

```bash
pulumi destroy --yes
pulumi stack rm dev       # optional: removes the stack itself
```

If you created the cluster with the `kind` CLI (Ubuntu server), delete it as well:

```bash
kind delete cluster --name guestbook
```