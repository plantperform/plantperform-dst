import logging
import signal
from threading import Event

from optimizer.consumer import Consumer


def main():
    logging.basicConfig(level=logging.INFO)
    stop = Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        Consumer.from_environment(stop).run()
    except Exception:
        logging.exception("fargate_consumer_failed")
        raise


if __name__ == "__main__":
    main()
