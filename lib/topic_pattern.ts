export function mqttParse(topic: string): string[] {
  let result = String(topic).split('/');
  for (let i = 0; i < result.length; i++) {
    if (result[i] === '+') {
      result[i] = '*';
    }
  }
  return result;
}

export function wampUriParse(topic: string): string[] {
  return String(topic).split('.');
}

export function defaultParse(topic: string): string[] {
  return String(topic).split('.');
}

export function restoreUri(topic: string[]): string {
  return topic.join('.');
}

export function restoreMqttUri(topic: string[]): string {
  return topic.join('/');
}

export function mqttMatch(topic: string, filter: string): boolean {
  return match(mqttParse(topic), mqttParse(filter));
}

export function wampMatch(topic: string, filter: string): boolean {
  return match(wampUriParse(topic), wampUriParse(filter));
}

export function isPattern(topicParts: string[]): boolean {
  for (let i = 0; i < topicParts.length; i++) {
    if (topicParts[i] === '*' || topicParts[i] === '#') {
      return true;
    }
  }
  return false;
}

export function match(topicParts: string[], filterParts: string[]): boolean {
  const length = filterParts.length;

  for (let i = 0; i < length; ++i) {
    let pattern = filterParts[i];
    let topic = topicParts[i];
    if (pattern === '#') return topicParts.length >= length - 1;
    if (pattern !== '*' && pattern !== topic) return false;
  }
  return length === topicParts.length;
}

export function intersect(topicParts: string[], filterParts: string[]): boolean {
  const length = Math.min(topicParts.length, filterParts.length);

  for (let i = 0; i < length; ++i) {
    let shape = filterParts[i];
    let pattern = topicParts[i];
    if (shape === '#' || pattern === '#') return true;
    if (shape !== pattern && pattern !== '*' && shape !== '*') return false;
  }
  if (topicParts.length > filterParts.length) {
    return topicParts[length] === '#';
  }
  if (topicParts.length < filterParts.length) {
    return filterParts[length] === '#';
  }
  return true;
}

export function extract(topicParts: string[], patternParts: string[]): string[] {
  let res: string[] = [];
  const length = patternParts.length;

  for (let i = 0; i < length; ++i) {
    let pattern = patternParts[i];
    if (pattern === '#') {
      if (i <= topicParts.length) {
        return res.concat(topicParts.slice(i));
      } else {
        return [];
      }
    }
    let topic = topicParts[i];
    if (pattern === '*') {
      res.push(topic);
    } else if (pattern !== topic) {
      return [];
    }
  }
  if (length === topicParts.length) {
    return res;
  } else {
    return [];
  }
}

export function mqttExtract(topic: string, pattern: string): string[] | null {
  return extract(mqttParse(topic), mqttParse(pattern));
}

export function merge(topicParts: string[], patternParts: string[]): string[] {
  let res: string[] = [];
  const length = patternParts.length;

  let k = 0;
  for (let i = 0; i < length; ++i) {
    let pattern = patternParts[i];
    if (pattern === '#') {
      if (k <= topicParts.length) {
        return res.concat(topicParts.slice(k));
      } else {
        return null as any;
      }
    }
    let topic = topicParts[k];
    if (pattern === '*') {
      res.push(topic);
      k++;
    } else {
      res.push(pattern);
    }
  }
  return res;
}
