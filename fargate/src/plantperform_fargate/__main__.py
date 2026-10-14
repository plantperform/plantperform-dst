import logging
import signal
from threading import Event

from app.services.fargate_control import ecs_client
from plantperform_fargate.configuration import initialize_configuration
from plantperform_fargate.consumer import Consumer, TaskProtection, consumer_sqs_client


def main():
    logging.basicConfig(level=logging.INFO)
    stop = Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        initialize_configuration()
        from app.data import optimization_store

        Consumer(
            consumer_sqs_client(), ecs_client(), optimization_store, TaskProtection(), stop
        ).run()
    except Exception:
        logging.exception("fargate_consumer_failed")
        raise


if __name__ == "__main__":
    main()
