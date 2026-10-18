"use client";

import { ArrowRight, MagnifyingGlass, X } from "@phosphor-icons/react";
import Form from "next/form";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

import { sidebarPeopleFromDirectory } from "@/lib/workspace-sidebar";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { peopleDirectoryHref, personMemoryHref, readPeopleDirectoryQuery } from "./people-directory-navigation";
import { validReturnSessionId } from "./session-return-navigation";
import { useRememberWorkspaceNavigationHref } from "./workspace-navigation-continuity";
import { useWorkspaceDirectory } from "./workspace-search";
import styles from "./workspace-sidebar-people.module.css";

const DIRECTORY_LIMIT = 200;

function selectedPersonId(pathname: string): string | null {
  const match = /^\/workspace\/people\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** A credential change remounts drafts as well as the authorized projection. */
export function WorkspaceSidebarPeople({ binding }: { binding: string | null }) {
  return <PeopleDirectory key={binding ?? "unbound"} binding={binding} />;
}

function PeopleDirectory({ binding }: { binding: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = selectedPersonId(pathname);
  const queryParameter = selectedId ? "directory_query" : "query";
  // Repeated parameters are ambiguous, just as they are on a directory return.
  const queryValues = searchParams.getAll(queryParameter);
  const query = binding && queryValues.length === 1
    ? readPeopleDirectoryQuery(queryValues[0])
    : "";
  const returnSessionId = validReturnSessionId(searchParams.get("session"));
  const rememberNavigationHref = useRememberWorkspaceNavigationHref();
  const [search, setSearch] = useState({ query, draft: query, committedDraft: query });
  const [composing, setComposing] = useState(false);
  const composingInput = useRef(false);
  const enterFromIme = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const { data, loading, failed, retry } = useWorkspaceDirectory(binding, Boolean(binding));

  // Adjust only a changed URL search; refreshes never replace the input node
  // or its draft. Let the IME finish before applying deliberate navigation.
  if (!composing && search.query !== query) {
    setSearch({ query, draft: query, committedDraft: query });
  }
  const draft = search.draft;
  function setDraft(value: string) {
    setSearch(current => ({ ...current, draft: value }));
  }
  function rememberDirectory(value = search.committedDraft) {
    if (binding) rememberNavigationHref(peopleDirectoryHref(value, returnSessionId));
  }
  function commitDraft(value: string) {
    const committedDraft = readPeopleDirectoryQuery(value);
    setSearch(current => ({ ...current, draft: value, committedDraft }));
    rememberDirectory(committedDraft);
  }

  const people = failed ? [] : sidebarPeopleFromDirectory(data?.people, DIRECTORY_LIMIT);
  const normalizedDraft = readPeopleDirectoryQuery(draft);
  const filter = normalizedDraft.toLocaleLowerCase();
  const matches = people.filter(person => !filter ||
    [person.label, ...person.contexts.map(context => context.label)]
      .join(" ").normalize("NFKC").toLocaleLowerCase().includes(filter));
  const bounded = (data?.people.people?.length ?? 0) >= DIRECTORY_LIMIT;

  return (
    <section aria-label="人物目录" className={styles.directory}>
      <header className={styles.headingRow}>
        <h2 className={styles.heading}>人物目录</h2>
        {binding ? <Link className={styles.allPeople} href={peopleDirectoryHref(search.committedDraft, returnSessionId)} onClick={() => rememberDirectory()} scroll={false}>查看全部人物</Link> : null}
      </header>
      {binding ? (
        <Form
          action="/workspace/people"
          className={styles.search}
          onKeyDown={event => {
            // Some engines end composition before dispatching the Enter submit.
            // Guard the submit while leaving native candidate selection intact.
            if (event.key === "Enter" || event.nativeEvent.keyCode === 229) {
              enterFromIme.current = event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229 || composingInput.current;
            }
          }}
          onKeyUp={() => { enterFromIme.current = false; }}
          onPointerDown={() => { enterFromIme.current = false; }}
          onSubmit={event => {
            if (composingInput.current || enterFromIme.current) {
              event.preventDefault();
              return;
            }
            rememberDirectory();
          }}
          scroll={false}
        >
          <MagnifyingGlass aria-hidden="true" size={16} />
          <input
            aria-label="搜索侧栏人物"
            autoComplete="off"
            maxLength={160}
            name="query"
            onChange={event => {
              const value = event.currentTarget.value;
              if (composingInput.current || (event.nativeEvent as InputEvent).isComposing) {
                setDraft(value);
              } else {
                commitDraft(value);
              }
            }}
            onCompositionStart={() => {
              composingInput.current = true;
              setComposing(true);
            }}
            onCompositionEnd={event => {
              composingInput.current = false;
              commitDraft(event.currentTarget.value);
              setComposing(false);
            }}
            placeholder="搜索人物…"
            ref={input}
            type="search"
            value={draft}
          />
          {returnSessionId ? <input name="session" type="hidden" value={returnSessionId} /> : null}
          {draft ? (
            <Link
              aria-label="清除侧栏人物搜索"
              className={styles.searchControl}
              href={peopleDirectoryHref("", returnSessionId)}
              onClick={() => {
                commitDraft("");
                input.current?.focus({ preventScroll: true });
              }}
              scroll={false}
            >
              <X aria-hidden="true" size={14} />
            </Link>
          ) : null}
          <button
            aria-label="在人物目录中搜索"
            className={styles.searchControl}
            disabled={composing}
            type="submit"
          >
            <ArrowRight aria-hidden="true" size={15} />
          </button>
        </Form>
      ) : null}

      {binding && !loading && !failed && bounded ? (
        <p className={styles.scope}>侧栏仅显示目录前 200 位人物。</p>
      ) : null}

      {!binding ? (
        <p className={styles.state} role="alert">请重新登录以读取人物目录。</p>
      ) : loading ? (
        <p className={styles.state} role="status">正在读取人物目录…</p>
      ) : failed ? (
        <div className={styles.state} role="alert">
          <p>人物目录暂时无法读取。</p>
          <button className={styles.retry} onClick={retry} type="button">重新载入</button>
        </div>
      ) : matches.length ? (
        <nav aria-label="侧栏人物">
          <ul className={styles.list}>
            {matches.map(person => (
              <li key={person.id}>
                <Link
                  aria-current={selectedId === person.id ? "page" : undefined}
                  className={styles.person}
                  href={personMemoryHref(person.id, search.committedDraft, returnSessionId)}
                  onClick={() => rememberDirectory()}
                  // Living pages may read Memory; only an explicit open owns that read.
                  prefetch={false}
                >
                  <PersonDirectoryAvatar id={person.id} label={person.label} url={person.avatarUrl} size={28} />
                  <span className={styles.identity}>
                    <strong>{person.label}</strong>
                    <small>{person.detail}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <p className={styles.state} role="status">
          {normalizedDraft ? "侧栏目录中没有匹配人物。" : "还没有人物。"}
        </p>
      )}

      {binding && !loading && !failed && normalizedDraft && !matches.length ? (
        <p className={styles.scope}>按 Enter 在人物目录中搜索姓名或已确认联系方式。</p>
      ) : null}
    </section>
  );
}
