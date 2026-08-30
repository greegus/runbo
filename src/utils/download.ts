/** Hands the browser a JSON file. DOM-only, so it carries no spec — and no rule. */
export function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next tick: Safari has not finished reading the blob when
  // click() returns, and a revoked URL there saves an empty file.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
