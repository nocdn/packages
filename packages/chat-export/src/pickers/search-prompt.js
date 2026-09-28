import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isUpKey,
  useEffect,
  useKeypress,
  usePagination,
  usePrefix,
  useRef,
  useState,
} from "@inquirer/core"

// A searchable list that refuses Enter until the rendered results match the
// latest query, so a stale result can never be selected while typing.
export const searchPrompt = createPrompt((config, done) => {
  const [query, setQuery] = useState(config.initialValue)
  const [items, setItems] = useState([])
  const [active, setActive] = useState(0)
  const [status, setStatus] = useState("loading")
  const [failure, setFailure] = useState()
  const requested = useRef(query)
  const rendered = useRef()
  const prefix = usePrefix({ status })

  useEffect((rl) => {
    if (config.initialValue) rl.write(config.initialValue)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading")
    void config
      .source(query, controller.signal)
      .then((results) => {
        if (controller.signal.aborted) return
        rendered.current = query
        setItems(results)
        setActive(0)
        setStatus("idle")
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailure(error instanceof Error ? error : new Error(String(error)))
        }
      })
    return () => controller.abort()
  }, [query])

  useKeypress((key, rl) => {
    if (key.name === "escape") {
      done(null)
      return
    }
    if (isEnterKey(key)) {
      const selected = items[active]
      if (
        status !== "idle" ||
        rendered.current !== requested.current ||
        !selected
      ) {
        rl.write(requested.current)
        return
      }
      setStatus("done")
      done(selected)
      return
    }
    if (isUpKey(key) || isDownKey(key)) {
      rl.clearLine(0)
      rl.write(requested.current)
      if (status === "idle") {
        setActive(
          Math.max(
            0,
            Math.min(items.length - 1, active + (isUpKey(key) ? -1 : 1)),
          ),
        )
      }
      return
    }
    requested.current = rl.line
    setQuery(rl.line)
  })

  const page = usePagination({
    items: status === "loading" ? [] : items,
    active,
    pageSize: 8,
    loop: false,
    renderItem: ({ item, isActive }) =>
      `${isActive ? ">" : " "} ${item.display}`,
  })
  if (failure) throw failure
  const selected = status === "idle" ? items[active] : undefined
  const preview = selected && config.preview?.(selected)
  return `${prefix} ${config.message} ${query}
${status === "loading" ? "Reading/searching chats..." : page || "No matches"}
${preview ? `\n${preview}\n` : ""}
↑↓ navigate \xB7 Enter selects \xB7 Esc cancels`
})
