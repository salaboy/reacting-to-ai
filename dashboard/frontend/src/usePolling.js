import { useEffect, useState, useRef } from 'react'

// usePolling calls fn immediately then every intervalMs and exposes the latest
// result. Re-runs the effect when deps change. Cancels in-flight responses on
// unmount via the running flag so we don't setState after teardown.
export function usePolling(fn, intervalMs = 3000, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const runningRef = useRef(true)

  useEffect(() => {
    runningRef.current = true
    let timer

    const tick = async () => {
      const result = await fn()
      if (!runningRef.current) return
      setData(result)
      setLoading(false)
      timer = setTimeout(tick, intervalMs)
    }
    tick()

    return () => {
      runningRef.current = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading }
}
