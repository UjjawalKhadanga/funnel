class Queue<T> {
  private queue: T[] = [];
  private maxQueueSize: number;

  constructor(maxQueueSize: number) {
    this.maxQueueSize = maxQueueSize;
  }

  enqueue(item: T) {
    this.queue.push(item);
  }

  dequeue(): T | undefined {
    return this.queue.shift();
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  size(): number {
    return this.queue.length;
  }

  peek(): T | undefined {
    if (this.isEmpty()) {
      return undefined;
    }
    return this.queue[0];
  }
}

export default Queue;