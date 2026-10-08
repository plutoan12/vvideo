"""Framework-neutral controller: call poll() from the GUI's timer."""
from queue import Queue, Empty
from shorts_automator import ShortsPackagingPlugin


class PackagingController:
    def __init__(self, plugin=None):
        self.plugin = plugin or ShortsPackagingPlugin()
        self.events = Queue()
        self.job = None

    def start(self, source, destination, batch=False):
        if self.job and not self.job.future.done():
            raise RuntimeError("A packaging job is already running")
        self.events = Queue()
        fn = self.plugin.start_batch if batch else self.plugin.start_single
        self.job = fn(source, destination, on_progress=self.events.put)

    def poll(self):
        """Returns (progress_events, done). Safe to call in the UI thread."""
        events = []
        while True:
            try:
                events.append(self.events.get_nowait())
            except Empty:
                break
        return events, bool(self.job and self.job.future.done())

    def result(self):
        if not self.job or not self.job.future.done():
            raise RuntimeError("Result is not ready; poll first")
        return self.job.future.result()

    def cancel(self):
        if self.job:
            self.job.cancel()
