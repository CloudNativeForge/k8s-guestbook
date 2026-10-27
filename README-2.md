# Guestbook monitoring stack

Pulumi TypeScript program that deploys nginx (frontend), Redis with a metrics exporter, and kube-prometheus-stack (Grafana / Prometheus) onto a local Kubernetes cluster.

## Prerequisites

- Docker Desktop with Kubernetes enabled (cluster type: **kind**, managed by Docker Desktop). At least 4 GB RAM allocated to Docker (Settings → Resources); pods stay `Pending` if there is too little.
- `kubectl`
- Node.js and npm
- Pulumi CLI
- `helm` (optional, only needed to inspect or uninstall releases manually)

> **No `kind` CLI needed.** Docker Desktop creates and manages the cluster itself, so commands like `kind create cluster` are not used. Running `kind` on its own gives `zsh: command not found: kind`, which is expected and harmless here.

### Install Pulumi

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

## Deploy

### 1. Point kubectl at the cluster

Pulumi deploys to whichever kubectl context is currently selected, so check this first:

```bash
kubectl config get-contexts
kubectl config use-context docker-desktop
kubectl get nodes          # should show one node, Ready
```

### 2. Create the Pulumi stack

A **project** is the code folder (`k8s-guestbook`). A **stack** is one deployed instance of it (here, `dev`). A project with no stack cannot be deployed.

```bash
cd k8s-guestbook
ls Pulumi.yaml            # confirm you are in the project folder
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
- With local state, the passphrase variable must be exported again in every new terminal. Add it to `~/.zshrc` to avoid repeating this. Pulumi Cloud does not need it.

### 3. Set config

Config is stored per stack, so the stack must exist first.

```bash
pulumi config set grafanaAdminPassword 'ChangeMe123'
```

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

Docker Desktop's cluster has no cloud load balancer, and the NodePort is not published to your laptop. Use `kubectl port-forward` (each command keeps running, so use a separate terminal for each).

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

| Item | URL |
|---|---|
| Prometheus UI | http://localhost:9090 |
| Scrape targets | http://localhost:9090/targets |

### Grafana access details

| Item | Value |
|---|---|
| URL | http://localhost:3000 (requires the Grafana port-forward above) |
| Username | `admin` |
| Password | value of `grafanaAdminPassword` (`ChangeMe123` on the `dev` stack) |

The Pulumi stack also outputs the Grafana URL and credentials:

```bash
pulumi stack output
```

## Verify that metrics are being scraped

1. Start the Prometheus port-forward (above) and open the targets page: [http://localhost:9090/targets](http://localhost:9090/targets).
2. Find `serviceMonitor/monitoring/redis-leader`. It should show **UP**.
3. On the **Graph** page, run these queries:

| Query | What it shows |
|---|---|
| `redis_up` | `1` means the exporter can reach Redis |
| `redis_commands_processed_total` | Backend (Redis) request counter |
| `rate(redis_commands_processed_total[1m])` | Redis commands per second |
| `container_memory_working_set_bytes{pod=~"nginx.*"}` | Frontend memory usage |
| `rate(container_cpu_usage_seconds_total{pod=~"nginx.*"}[1m])` | Frontend CPU usage |

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
|---|---|
| `zsh: command not found: kind` | The `kind` CLI is not installed and is not needed with Docker Desktop's Kubernetes. Skip any `kind` commands. |
| `no Pulumi.yaml found` | You are not in the project folder. `cd k8s-guestbook`. |
| Project exists but `pulumi stack ls` is empty | Run `pulumi stack init dev`. |
| Passphrase prompt on every Pulumi command | `export PULUMI_CONFIG_PASSPHRASE=""` (see Deploy, step 2). |
| `services "..." not found` | Either the app is not deployed (`pulumi up`), kubectl is on the wrong context (`kubectl config use-context docker-desktop`), or Pulumi autonaming added a random suffix. Run `kubectl get svc` (and `kubectl get svc -n monitoring`) to see the real names, and set `metadata.name` (or `name:` on the Helm release) explicitly. Search all namespaces with `kubectl get svc -A \| grep <name>`. |
| Pods stuck `Pending` | Raise Docker Desktop memory to 6 GB or more (Settings → Resources). |
| ServiceMonitor creation fails | The Helm release has not finished installing, so the CRD does not exist yet. Make sure the ServiceMonitor has `dependsOn: [monitoring]`. |
| Target missing in Prometheus | The ServiceMonitor `matchLabels`, port name, or namespace does not match the Service. Check with `kubectl get svc redis-leader --show-labels`. |
| `localhost:3000` not reachable | The Grafana port-forward is not running. |
| `pulumi up` hangs on a Service | A `LoadBalancer` Service never gets an external IP on a local cluster. Use `NodePort` or `ClusterIP`. |

## Issues we hit

### 1. Invalid `index.ts` (frontend Service nested in the nginx Deployment)

The frontend Service was pasted inside the nginx Deployment constructor. `frontendLabels` was undefined and the braces did not match, so TypeScript could not compile.

**Fix:** Close the Deployment, define `frontendLabels`, and declare the Service as its own resource with `metadata.name: "frontend"`.

### 2. `kubectl port-forward svc/frontend 8080:80` — Service not found

Pulumi’s first `up` only created the nginx Deployment. There was no Service named `frontend` (only `kubernetes` in `default`). Port-forward failed with `services "frontend" not found`.

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

The stack exports `grafanaUrl = "http://localhost:3000"`, but Grafana is a NodePort on **30300**. `localhost:3000` only works with a port-forward:

```bash
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
```

Login: `admin` / value of `grafanaAdminPassword` (`ChangeMe123` on the `dev` stack).

This is because the cluster is Docker Desktop's kind-type Kubernetes, not a cluster created with the `kind` CLI. A kind `extraPortMappings` entry (30300 → 3000) can only be set when a cluster is created with `kind create cluster --config`, which Docker Desktop does not allow.

### 6. Redis ServiceMonitor must match Service labels and namespaces

Prometheus lives in `monitoring`. Redis is in `default`. A ServiceMonitor in `monitoring` will not scrape Redis unless:

- The Service is labeled `app: redis-leader`
- It exposes a named port `metrics` on `9121`
- The ServiceMonitor uses `namespaceSelector.matchNames: ["default"]`
- It depends on the Helm release so the ServiceMonitor CRD exists first
- Prometheus is configured with `serviceMonitorSelectorNilUsesHelmValues: false`, so it also picks up ServiceMonitors that lack the Helm release label

### 7. Project created but no stack

`pulumi new` created the project (`k8s-guestbook`) but no `dev` stack, so config and `pulumi up` had nothing to attach to.

**Fix:** log in to a backend (`pulumi login` for Pulumi Cloud, or `pulumi login --local` plus `PULUMI_CONFIG_PASSPHRASE` for local state), then `pulumi stack init dev` (or `pulumi stack select dev` if it already exists).

### 8. `kind` command not found

The cluster shown in Docker Desktop (Kubernetes → cluster type: kind) is managed by Docker Desktop itself, so the standalone `kind` CLI is not installed and not needed.

**Fix:** Skip `kind` commands. Select the context with `kubectl config use-context docker-desktop` and use `kubectl port-forward` to reach services.

## Current layout

| Resource | Name | Notes |
|---|---|---|
| Deployment + Service | nginx / `frontend` | NodePort 80 |
| Deployment + Service | `redis-leader` | Redis 6379 + exporter 9121 |
| Namespace | `monitoring` | kube-prometheus-stack |
| Helm release | `monitoring` | Grafana NodePort 30300 |
| ServiceMonitor | `redis-leader` | scrapes `default` Redis metrics |

## Config

```bash
pulumi config set grafanaAdminPassword 'ChangeMe123'
```

The original Pulumi Guestbook example uses an `isMinikube` setting to switch its frontend from `LoadBalancer` to `ClusterIP`. It is only needed if you use that example's frontend code, and it works on kind and Docker Desktop too despite the name. This program uses a `NodePort` frontend, so the setting is not required.

## Clean up

```bash
pulumi destroy --yes
pulumi stack rm dev       # optional: removes the stack itself
```