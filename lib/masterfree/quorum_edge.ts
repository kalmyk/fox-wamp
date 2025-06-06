// M: Represents the type of a member.
// T: Represents the type of a topic.
// V: Represents the type of a value being voted upon. This makes the class reusable
//     for different kinds of members, topics, and values.

interface WaitForItem<V, M> {
  value: V;
  members: M[];
  done: boolean;
}

type NotifyFunction<T, V> = (topic: T, value: V) => void;
type ReduceFunction<V> = (currentValue: V, newValue: V) => V;

export class QuorumEdge<M, T, V> {
  private waitFor: Map<T, WaitForItem<V, M>>;
  private notify: NotifyFunction<T, V>;
  private reduce: ReduceFunction<V>;
  private limit: number;
  private members: Map<M, true>; // Using 'true' as value to simulate a Set with a Map

  constructor (notify: NotifyFunction<T, V>, reduce: ReduceFunction<V>) {
    this.waitFor = new Map<T, WaitForItem<V, M>>();
    this.notify = notify;
    this.reduce = reduce;
    this.limit = 2; // Default limit
    this.members = new Map<M, true>();
  }

  setLimit(limit: number): void {
    this.limit = limit;
  }

  addMember (member: M): void {
    this.members.set(member, true);
  }

  delMember (member: M): void {
    this.members.delete(member);
  }

  vote(member: M, topic: T, value: V): void {
    let item: WaitForItem<V, M> | undefined = this.waitFor.get(topic);

    if (item) {
      if (!item.done) {
        item.value = this.reduce(item.value, value);
      }
    } else {
      item = {
        value,
        members: [],
        done: false
      };
      this.waitFor.set(topic, item);
    }

    item.members.push(member);

    if (item.members.length >= this.limit && !item.done) {
      item.done = true;
      this.notify(topic, item.value);
    }

    // If all known members have voted, clean up the topic from waitFor
    if (this.members.size > 0 && item.members.length >= this.members.size) {
      this.waitFor.delete(topic);
    }
  }
}
