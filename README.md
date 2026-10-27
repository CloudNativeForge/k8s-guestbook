# Guestbook monitoring stack

Pulumi TypeScript program that deploys nginx (frontend), Redis with a metrics exporter, and kube-prometheus-stack (Grafana / Prometheus) onto a local Kubernetes cluster.

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

Without `name: "monitoring"` on `k8s.helm.v3.Release`, Helm installed the chart as `monitoring-8c3a3fbd`. Adding `name: "monitoring"` later **renames** the Helm release. Helm cannot rename in place, so Pulumi tried to install a **second** kube-prometheus-stack.

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

Result: a single deployed release named `monitoring`.

### 5. Grafana URL vs NodePort

The stack exports `grafanaUrl = "http://localhost:3000"`, but Grafana is a NodePort on **30300**. `localhost:3000` only works with a port-forward:

```bash
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
```

Login: `admin` / value of `grafanaAdminPassword` (`ChangeMe123` on the `dev` stack).

### 6. Redis ServiceMonitor must match Service labels and namespaces

Prometheus lives in `monitoring`. Redis is in `default`. A ServiceMonitor in `monitoring` will not scrape Redis unless:

- The Service is labeled `app: redis-leader`
- It exposes a named port `metrics` on `9121`
- The ServiceMonitor uses `namespaceSelector.matchNames: ["default"]`
- It depends on the Helm release so the ServiceMonitor CRD exists first

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