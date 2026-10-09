"use client";

import { ArrowRight, MagnifyingGlass, X } from "@phosphor-icons/react";
import Form from "next/form";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "./ui/button";
import { withReturnSession } from "./session-return-navigation";
import styles from "./people-directory-app.module.css";

export function PeopleDirectorySearch({ query, returnSessionId }: {
  query: string; returnSessionId: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const clearing = useRef(false);
  useEffect(() => {
    if (!clearing.current) return;
    clearing.current = false;
    const active = document.activeElement;
    if (!query && (active === document.body || input.current?.form?.contains(active))) {
      input.current?.focus({ preventScroll: true });
    }
  }, [query]);

  return (
    <Form action="/workspace/people" className={styles.search} data-filter-active={query ? true : undefined} scroll={false}>
      <MagnifyingGlass aria-hidden="true" size={20} />
      <input
        ref={input}
        aria-label="按姓名或已确认联系方式搜索人物"
        defaultValue={query}
        key={query}
        maxLength={160}
        name="query"
        placeholder="按姓名、邮箱或电话查找…"
        type="search"
      />
      {returnSessionId ? <input name="session" type="hidden" value={returnSessionId} /> : null}
      {query ? (
        <Button asChild variant="ghost" size="icon" className={styles.clearSearch}>
          <Link
            aria-label="清除人物搜索"
            href={withReturnSession("/workspace/people", returnSessionId)}
            onNavigate={() => { clearing.current = true; }}
            scroll={false}
          >
            <X aria-hidden="true" size={16} />
          </Link>
        </Button>
      ) : null}
      <Button aria-label="搜索人物" variant="ghost" size="icon" type="submit">
        <ArrowRight aria-hidden="true" size={15} />
      </Button>
    </Form>
  );
}
