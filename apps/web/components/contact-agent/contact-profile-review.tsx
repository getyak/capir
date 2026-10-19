"use client";

import { useState } from "react";
import type { ContactProfileConfirmation, ScreenshotContactTaskResponse } from "@talent-signal/agent";
import styles from "./contact-agent.module.css";

const labels:Record<string,string>={name:"截图姓名",company:"公司",job_title:"职位",handle:"平台账号",profile_url:"资料链接"};

export function ReviewedContactProfile({profile}:{profile:NonNullable<ScreenshotContactTaskResponse["reviewed_profile"]>}){
  return <div className={styles.section}><h3>本次核对保存的资料</h3>
    <p>{profile.display_name} · {profile.platform}</p>
    <dl className={styles.profile}>{profile.fields.map(field=><div key={field.clue_index}>
      <dt>{labels[field.kind]}</dt><dd>{field.value}<details><summary>查看图片 {field.source_image_index+1} 的原文</summary>
        <blockquote>{field.source_excerpt}</blockquote></details></dd>
    </div>)}</dl>
  </div>;
}

type ReviewProps = {task:ScreenshotContactTaskResponse;busy:boolean;
  onConfirm:(review:ContactProfileConfirmation)=>Promise<void>};

export function ContactProfileReview(props: ReviewProps) {
  // A revision-only refresh preserves edits. Changed evidence starts a fresh
  // review so an old value cannot silently attach to a reused clue index.
  const evidence = JSON.stringify(props.task.contact_draft);
  const [originalEvidence] = useState(evidence);
  return <>
    {originalEvidence !== evidence ? <p role="status">资料依据已变化，已载入最新草稿，请重新核对后保存。</p> : null}
    <ContactProfileReviewFields key={evidence} {...props} />
  </>;
}

function ContactProfileReviewFields({task,busy,onConfirm}: ReviewProps){
  const draft=task.contact_draft!;
  const [name,setName]=useState(draft.display_name);
  const [values,setValues]=useState(()=>Object.fromEntries(draft.fields.map(f=>[f.clue_index,f.value])));
  function confirm(candidate?:ScreenshotContactTaskResponse["candidates"][number]){
    return onConfirm({decision:"save_reviewed_profile",expected_revision:task.revision,display_name:name.trim(),
      fields:draft.fields.filter(f=>values[f.clue_index]?.trim()).map(f=>({clue_index:f.clue_index,value:values[f.clue_index]!.trim()})),
      ...(candidate?{selected_person_id:candidate.person_id,selected_relationship_context_id:candidate.relationship_context_id}:{create_new:true})});
  }
  return <div className={styles.question}>
    <h3>{task.question??"核对联系人资料"}</h3>
    <p>来源平台：{draft.platform}</p>
    <p>确认前尚未创建联系人。保留的账号线索会用于查重；清空字段即可不保存该项。</p>
    <label className={styles.label}>联系人姓名<input value={name} onChange={e=>setName(e.target.value)} maxLength={200} disabled={busy}/></label>
    {draft.fields.map(field=><div key={field.clue_index}>
      <label className={styles.label}>{labels[field.kind]}<input value={values[field.clue_index]??""}
        onChange={e=>setValues(previous=>({...previous,[field.clue_index]:e.target.value}))} maxLength={300} disabled={busy}/></label>
      <details><summary>查看图片 {field.source_image_index+1} 的依据</summary><blockquote>{field.source_excerpt}</blockquote></details>
    </div>)}
    <p>修改内容会记为你的核对结果，截图原文保留为来源。</p>
    {task.candidates.map(candidate=><button key={`${candidate.person_id}:${candidate.relationship_context_id}`}
      onClick={()=>void confirm(candidate)} disabled={busy||!name.trim()}>保存到 {candidate.display_name} · {candidate.relationship_label}</button>)}
    <button className={styles.primary} onClick={()=>void confirm()} disabled={busy||!name.trim()}>{busy?"正在保存…":task.candidates.length?"添加为新联系人":"确认资料并保存"}</button>
  </div>;
}
