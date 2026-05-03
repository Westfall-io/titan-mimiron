export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function relativeTime(iso) {
  const then = new Date(iso).getTime();
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.round(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.round(mon / 12)}y ago`;
}

export function repoLink(uri) {
  if (!uri) return '#';
  if (uri.startsWith('git@')) {
    return uri.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
  }
  return uri.replace(/\.git$/, '');
}

export function trackerLink(part) {
  if (part.issue_tracker_uri) return part.issue_tracker_uri;
  return `${repoLink(part.repo_uri)}/issues`;
}
