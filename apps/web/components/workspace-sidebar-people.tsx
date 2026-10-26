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
import { useWorkspaceBrowse } from "./workspace-browse";
import { useT } from "./locale-provider";
import { useWorkspaceDirectory } from "./workspace-search";
import styles from "./workspace-sidebar-people.module.css";
import { ListOrderMenu, useWorkspaceListReorder } from "./workspace-list-order";

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
export function WorkspaceSidebarPeople({ binding, browseHref }: { binding: string | null; browseHref?: string }) {
  return <PeopleDirectory key={binding ?? "unbound"} binding={binding} browseHref={browseHref} />;
}

function PeopleDirectory({ binding, browseHref }: { binding: string | null; browseHref?: string }) {
  const t = useT();
  const pathname = usePathname();
  const routeSearchParams = useSearchParams();
  const searchParams = browseHref === undefined ? routeSearchParams : new URLSearchParams(browseHref.split("?")[1]);
  const selectedId = selectedPersonId(pathname);
  const queryParameter = browseHref === undefined && selectedId ? "directory_query" : "query";
  // Repeated parameters are ambiguous, just as they are on a directory return.
  const queryValues = searchParams.getAll(queryParameter);
  const query = binding && queryValues.length === 1
    ? readPeopleDirectoryQuery(queryValues[0])
    : "";
  const returnSessionId = validReturnSessionId(searchParams.get("session"));
  const rememberRouteHref = useRememberWorkspaceNavigationHref();
  const browse = useWorkspaceBrowse();
  const rememberNavigationHref = browseHref !== undefined && browse ? browse.remember : rememberRouteHref;
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
  const order = useWorkspaceListReorder(matches, "people", { disabled: Boolean(normalizedDraft) });
  const bounded = (data?.people.people?.length ?? 0) >= DIRECTORY_LIMIT;

  return (
    <section aria-label={t("人物目录")} className={styles.directory}>
      <header className={styles.headingRow}>
        <h2 className={styles.heading}>{t("人物目录")}</h2>
        {binding ? <Link className={styles.allPeople} href={peopleDirectoryHref(search.committedDraft, returnSessionId)} onClick={() => rememberDirectory()} prefetch={false} scroll={false}>{t("查看全部人物")}</Link> : null}
      </header>
      {binding ? (
        <Form
          action="/workspace/people"
          prefetch={false}
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
            if (browseHref !== undefined) event.preventDefault();
            rememberDirectory();
          }}
          scroll={false}
        >
          <MagnifyingGlass aria-hidden="true" size={16} />
          <input
            aria-label={t("搜索侧栏人物")}
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
            placeholder={t("搜索人物…")}
            ref={input}
            type="search"
            value={draft}
          />
          {returnSessionId ? <input name="session" type="hidden" value={returnSessionId} /> : null}
          {draft ? (
            <Link
              aria-label={t("清除侧栏人物搜索")}
              className={styles.searchControl}
              href={peopleDirectoryHref("", returnSessionId)}
              onClick={event => {
                if (browseHref !== undefined) {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                }
                commitDraft("");
                input.current?.focus({ preventScroll: true });
              }}
              scroll={false}
            >
              <X aria-hidden="true" size={14} />
            </Link>
          ) : null}
          <button
            aria-label={browseHref === undefined ? t("在人物目录中搜索") : t("筛选侧栏人物")}
            className={styles.searchControl}
            disabled={composing}
            type="submit"
          >
            <ArrowRight aria-hidden="true" size={15} />
          </button>
        </Form>
      ) : null}

      {binding && !loading && !failed && bounded ? (
        <p className={styles.scope}>{t("侧栏仅显示目录前 200 位人物。")}</p>
      ) : null}

      {order.notice}
      {!binding ? (
        <p className={styles.state} role="alert">{t("请重新登录以读取人物目录。")}</p>
      ) : loading ? (
        <p className={styles.state} role="status">{t("正在读取人物目录…")}</p>
      ) : failed ? (
        <div className={styles.state} role="alert">
          <p>{t("人物目录暂时无法读取。")}</p>
          <button className={styles.retry} onClick={retry} type="button">{t("重新载入")}</button>
        </div>
      ) : matches.length ? (
        <nav aria-label={t("侧栏人物")}>
          <ul className={styles.list}>
            {order.ordered.map(person => (
              <li {...order.rowProps(person.id)} className={`${order.rowProps(person.id).className} ${styles.orderedPerson}`} key={person.id}>
                <Link
                  aria-current={selectedId === person.id ? "page" : undefined}
                  className={styles.person}
                  href={personMemoryHref(person.id, search.committedDraft, returnSessionId)}
                  onClick={() => rememberDirectory()}
                  // Living pages may read Memory; only an explicit open owns that read.
                  prefetch={false}
                >
                  <PersonDirectoryAvatar id={person.id} label={person.label} url={person.avatarUrl} size={18} />
                  <span className={styles.identity}>
                    <strong>{person.label}</strong>
                    <small>{person.contexts[0]?.label ?? t("联系人")}</small>
                  </span>
                </Link>
                <ListOrderMenu control={order.control(person.id)} label={person.label} />
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <p className={styles.state} role="status">
          {normalizedDraft ? t("侧栏目录中没有匹配人物。") : t("还没有人物。")}
        </p>
      )}

      {binding && !loading && !failed && normalizedDraft && !matches.length ? (
        <p className={styles.scope}>{browseHref === undefined ? t("按 Enter 在人物目录中搜索姓名或已确认联系方式。") : t("查看全部人物以搜索姓名或已确认联系方式。")}</p>
      ) : null}
    </section>
  );
}
