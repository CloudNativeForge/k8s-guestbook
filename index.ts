import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

const config = new pulumi.Config();
const grafanaPassword = config.require("grafanaAdminPassword");

const appLabels = { app: "nginx" };
const frontendLabels = appLabels;

const deployment = new k8s.apps.v1.Deployment("nginx", {
    spec: {
        selector: { matchLabels: appLabels },
        replicas: 1,
        template: {
            metadata: { labels: appLabels },
            spec: { containers: [{ name: "nginx", image: "nginx" }] },
        },
    },
});

const frontendService = new k8s.core.v1.Service("frontend", {
    metadata: {
        name: "frontend",
        labels: frontendLabels,
    },
    spec: {
        selector: frontendLabels,
        ports: [{ port: 80, targetPort: 80 }],
        type: "NodePort",
    },
});

const redisLabels = { app: "redis-leader" };

const redis = new k8s.apps.v1.Deployment("redis-leader", {
    spec: {
        selector: { matchLabels: redisLabels },
        replicas: 1,
        template: {
            metadata: { labels: redisLabels },
            spec: {
                containers: [
                    {
                        name: "redis",
                        image: "redis:7",
                        ports: [{ name: "redis", containerPort: 6379 }],
                    },
                    {
                        name: "metrics",
                        image: "oliver006/redis_exporter:v1.62.0",
                        ports: [{ name: "metrics", containerPort: 9121 }],
                    },
                ],
            },
        },
    },
});

const redisService = new k8s.core.v1.Service("redis-leader", {
    metadata: {
        name: "redis-leader",
        labels: redisLabels,
    },
    spec: {
        selector: redisLabels,
        ports: [
            { name: "redis", port: 6379, targetPort: 6379 },
            { name: "metrics", port: 9121, targetPort: 9121 },
        ],
    },
});

const ns = new k8s.core.v1.Namespace("monitoring", {
    metadata: { name: "monitoring" },
});

export const monitoring = new k8s.helm.v3.Release("monitoring", {
    name: "monitoring",
    chart: "kube-prometheus-stack",
    namespace: ns.metadata.name,
    repositoryOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
    values: {
        grafana: {
            adminUser: "admin",
            adminPassword: grafanaPassword,
            service: { type: "NodePort", nodePort: 30300 },
        },
        prometheus: {
            prometheusSpec: {
                // Lets Prometheus pick up ServiceMonitors that don't carry the Helm release label
                serviceMonitorSelectorNilUsesHelmValues: false,
                podMonitorSelectorNilUsesHelmValues: false,
            },
        },
    },
});

new k8s.apiextensions.CustomResource("redis-leader-sm", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: { name: "redis-leader", namespace: "monitoring" },
    spec: {
        namespaceSelector: { matchNames: ["default"] },
        selector: { matchLabels: { app: "redis-leader" } },
        endpoints: [{ port: "metrics", interval: "15s" }],
    },
}, { dependsOn: [monitoring] });

export const name = deployment.metadata.name;
export const frontendServiceName = frontendService.metadata.name;
export const redisName = redis.metadata.name;
export const redisServiceName = redisService.metadata.name;
export const grafanaUrl = "http://localhost:3000";
export const grafanaUser = "admin";
export const grafanaPasswordOut = grafanaPassword;
