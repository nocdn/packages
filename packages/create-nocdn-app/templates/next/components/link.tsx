"use client"

import NextLink from "next/link"
import { useRouter } from "next/navigation"
import { forwardRef, type ComponentProps, type MouseEvent } from "react"

type LinkProps = ComponentProps<typeof NextLink>

function toHrefString(href: LinkProps["href"]) {
  if (typeof href === "string") {
    return href
  }

  if (href instanceof URL) {
    return href.toString()
  }

  const pathname = href.pathname ?? ""
  const hash = href.hash ?? ""

  if (href.search) {
    return `${pathname}${href.search}${hash}`
  }

  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(href.query ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, String(item))
      }
      continue
    }

    if (value != null) {
      searchParams.append(key, String(value))
    }
  }

  const search = searchParams.toString()

  return `${pathname}${search ? `?${search}` : ""}${hash}`
}

function shouldNavigateOnMouseDown(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false
  }

  const { currentTarget } = event

  if (currentTarget.target && currentTarget.target !== "_self" && currentTarget.target !== "") {
    return false
  }

  if (currentTarget.hasAttribute("download")) {
    return false
  }

  const url = new URL(href, window.location.href)

  return url.origin === window.location.origin
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, onMouseDown, replace, scroll, ...props },
  ref
) {
  const router = useRouter()

  return (
    <NextLink
      ref={ref}
      href={href}
      replace={replace}
      scroll={scroll}
      onMouseDown={(event) => {
        onMouseDown?.(event)

        if (event.defaultPrevented) {
          return
        }

        const hrefString = toHrefString(href)

        if (!shouldNavigateOnMouseDown(event, hrefString)) {
          return
        }

        event.preventDefault()

        if (replace) {
          router.replace(hrefString, { scroll })
          return
        }

        router.push(hrefString, { scroll })
      }}
      {...props}
    />
  )
})

export default Link
