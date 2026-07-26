"use client"

import type { Route } from "next"
import NextLink from "next/link"
import { useRouter } from "next/navigation"
import { useRef, type ComponentProps, type MouseEvent } from "react"

type LinkProps = ComponentProps<typeof NextLink>
type OnNavigateEvent = Parameters<NonNullable<LinkProps["onNavigate"]>>[0]

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

export default function Link({
  href,
  onClick,
  onMouseDown,
  onNavigate,
  replace,
  scroll,
  ...props
}: LinkProps) {
  const router = useRouter()
  const handledOnMouseDown = useRef(false)

  return (
    <NextLink
      href={href}
      replace={replace}
      scroll={scroll}
      onNavigate={onNavigate}
      onMouseDown={(event) => {
        handledOnMouseDown.current = false
        onMouseDown?.(event)

        if (event.defaultPrevented) {
          return
        }

        const hrefString = toHrefString(href)

        if (!shouldNavigateOnMouseDown(event, hrefString)) {
          return
        }

        handledOnMouseDown.current = true

        let navigationPrevented = false
        onNavigate?.({
          preventDefault() {
            navigationPrevented = true
          },
        } as OnNavigateEvent)

        if (navigationPrevented) {
          return
        }

        const route = hrefString as Route

        if (replace) {
          router.replace(route, { scroll })
          return
        }

        router.push(route, { scroll })
      }}
      onClick={(event) => {
        onClick?.(event)

        if (handledOnMouseDown.current) {
          handledOnMouseDown.current = false
          event.preventDefault()
        }
      }}
      {...props}
    />
  )
}
