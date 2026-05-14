"""OpenTelemetry initialization.

Wires traces, metrics, and Python logs to the OTLP/gRPC endpoint defined by
OTEL_EXPORTER_OTLP_ENDPOINT. When that env var is unset, init_telemetry is a
no-op so the agent runs unchanged locally.
"""
import logging
import os

from opentelemetry import metrics, trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

_INITIALIZED = False


def init_telemetry(service_name: str) -> bool:
    """Set up tracer/meter/logger providers and library instrumentations.

    Returns True if telemetry was initialized, False if it was skipped because
    OTEL_EXPORTER_OTLP_ENDPOINT is not configured. Safe to call more than once.
    """
    global _INITIALIZED
    if _INITIALIZED:
        return True
    if not os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return False

    attrs = {} if os.getenv("OTEL_SERVICE_NAME") else {"service.name": service_name}
    resource = Resource.create(attrs)

    trace_provider = TracerProvider(resource=resource)
    trace_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(trace_provider)

    metric_reader = PeriodicExportingMetricReader(OTLPMetricExporter())
    meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
    metrics.set_meter_provider(meter_provider)

    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
    set_logger_provider(logger_provider)
    logging.getLogger().addHandler(LoggingHandler(logger_provider=logger_provider))

    RequestsInstrumentor().instrument()
    LoggingInstrumentor().instrument(set_logging_format=True)

    _INITIALIZED = True
    return True


def instrument_fastapi(app) -> None:
    """Apply FastAPI auto-instrumentation. Call after the FastAPI app is created."""
    if _INITIALIZED:
        FastAPIInstrumentor.instrument_app(app)
