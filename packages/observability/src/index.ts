// Logs, metrics and traces for every app on the platform. Metric names are declared once in METRICS; the
// alert definitions (config/alerts.yaml) may only use these, and the handover gate checks that.
import { AzureMonitorMetricExporter, AzureMonitorTraceExporter } from "@azure/monitor-opentelemetry-exporter";
import {
  type Attributes,
  type Counter,
  type Histogram,
  metrics,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  type MetricReader,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { platformConfig } from "@rop/platform";
import pino, { type Logger } from "pino";

export const METRICS = {
  http_server_requests_total: {
    kind: "counter",
    description: "HTTP requests by route, method and status class",
  },
  http_server_duration_ms: { kind: "histogram", description: "HTTP request duration in milliseconds" },
  shotlog_shot_conflicts_total: {
    kind: "counter",
    description: "Shot numbers taken by a concurrent writer and retried",
  },
  job_runs_total: { kind: "counter", description: "Scheduled job runs by job and outcome" },
  grants_unsubmitted_entries: {
    kind: "gauge",
    description: "Draft or returned time entries older than the recording window",
  },
  access_denied_total: {
    kind: "counter",
    description: "Requests refused by row-level security or a role check",
  },
} as const;
export type MetricName = keyof typeof METRICS;

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({
    name,
    level,
    base: { service: platformConfig().observability.service_name },
    // Tokens and cookies never reach a log line.
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "*.token", "*.password"],
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export interface Telemetry {
  tracer: Tracer;
  counter(name: MetricName, value?: number, attrs?: Attributes): void;
  histogram(name: MetricName, value: number, attrs?: Attributes): void;
  gauge(name: MetricName, value: number, attrs?: Attributes): void;
  /** test helpers */
  spans(): { name: string; attributes: Attributes; status: number }[];
  collect(): Promise<Record<string, number>>;
  shutdown(): Promise<void>;
}

/**
 * In-memory exporters always (tests read them); with APPLICATIONINSIGHTS_CONNECTION_STRING set, as infra/
 * sets it in Azure, traces and metrics also go to Application Insights, where the alert rules read them.
 */
export function createTelemetry(
  serviceName = platformConfig().observability.service_name,
  env: NodeJS.ProcessEnv = process.env,
): Telemetry {
  const resource = resourceFromAttributes({ "service.name": serviceName });
  const spanExporter = new InMemorySpanExporter();
  const azure = env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  const spanProcessors: SpanProcessor[] = [new SimpleSpanProcessor(spanExporter)];
  const readers: MetricReader[] = [];
  if (azure) {
    spanProcessors.push(new BatchSpanProcessor(new AzureMonitorTraceExporter({ connectionString: azure })));
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new AzureMonitorMetricExporter({ connectionString: azure }),
        exportIntervalMillis: 60_000,
      }),
    );
  }
  const tracerProvider = new BasicTracerProvider({ resource, spanProcessors });
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });
  readers.push(reader);
  const meterProvider = new MeterProvider({ resource, readers });
  const meter = meterProvider.getMeter(serviceName);
  const counters = new Map<string, Counter>();
  const histograms = new Map<string, Histogram>();
  const gauges = new Map<string, { value: number; attrs: Attributes }[]>();
  const tracer = tracerProvider.getTracer(serviceName);
  metrics.disable();
  trace.disable();

  const check = (name: MetricName, kind: string) => {
    if (METRICS[name].kind !== kind) throw new Error(`${name} is a ${METRICS[name].kind}, not a ${kind}`);
  };

  return {
    tracer,
    counter(name, value = 1, attrs = {}) {
      check(name, "counter");
      let c = counters.get(name);
      if (!c) {
        c = meter.createCounter(name, { description: METRICS[name].description });
        counters.set(name, c);
      }
      c.add(value, attrs);
    },
    histogram(name, value, attrs = {}) {
      check(name, "histogram");
      let h = histograms.get(name);
      if (!h) {
        h = meter.createHistogram(name, { description: METRICS[name].description, unit: "ms" });
        histograms.set(name, h);
      }
      h.record(value, attrs);
    },
    gauge(name, value, attrs = {}) {
      check(name, "gauge");
      if (!gauges.has(name)) {
        gauges.set(name, []);
        meter.createObservableGauge(name, { description: METRICS[name].description }).addCallback((r) => {
          for (const g of gauges.get(name) ?? []) r.observe(g.value, g.attrs);
        });
      }
      const list = gauges.get(name)!;
      const key = JSON.stringify(attrs);
      const i = list.findIndex((g) => JSON.stringify(g.attrs) === key);
      if (i >= 0) list[i] = { value, attrs };
      else list.push({ value, attrs });
    },
    spans() {
      return spanExporter
        .getFinishedSpans()
        .map((s) => ({ name: s.name, attributes: s.attributes, status: s.status.code }));
    },
    async collect() {
      await reader.forceFlush();
      const out: Record<string, number> = {};
      for (const rm of metricExporter.getMetrics()) {
        for (const sm of rm.scopeMetrics) {
          for (const m of sm.metrics) {
            let total = 0;
            for (const dp of m.dataPoints) {
              const v = dp.value as number | { count: number };
              total += typeof v === "number" ? v : v.count;
            }
            out[m.descriptor.name] = total;
          }
        }
      }
      metricExporter.reset();
      return out;
    },
    async shutdown() {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}
