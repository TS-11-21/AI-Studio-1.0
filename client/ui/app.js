"use strict";
(() => {
  const PERSONAL_MODE = document.body.dataset.personalMode === "true";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const ROLES = {gameplay:{label:"玩法与剧情",stage:"gpt_base",symbol:"G"},vfx:{label:"动画 / VFX",stage:"claude_vfx",symbol:"V"},integration:{label:"游戏整合",stage:"gpt_integrate",symbol:"↔"},research:{label:"资料研究",stage:"research",symbol:"R"}};
  const ADAPTERS = {codex:"Codex · ChatGPT 订阅",claude:"Claude Code · 已有网关",kimi:"Kimi Code · 会员 CLI","openrouter-research":"OpenRouter · 研究 API","external-command":"外部交接程序","manual-desktop":"桌面人工交接","openai-compatible-research":"API 兼容 · 研究"};
  const STATUSES = {CANCELLED:["本次任务已取消 · 配置保留","neutral"],CANCELLING:["正在取消本次任务","working"],CANCEL_FAILED:["取消未完成 · 需要处理","bad"],DONE:["已完成","good"],RUNNING:["执行中","working"],READY:["待执行","neutral"],DORMANT:["休眠","neutral"],FAILED:["失败","bad"],BLOCKED:["需要处理","bad"],INTERRUPTED:["已中断","wait"],NEEDS_REFERENCE:["等待资料","wait"],WAITING_EXTERNAL:["等待桌面交接","wait"],PAUSED:["已暂停 · 进度已保存","wait"],PAUSING:["正在暂停并保存","working"],RESUMING:["正在恢复","working"],WAITING_CONNECTION:["等待接入 / 费用批准","wait"],WAITING_APPROVAL:["等待费用批准","wait"],BUDGET_STOP:["预算 / 次数停止","bad"],UNKNOWN:["未验证","neutral"],CONNECTED:["已连接","good"],AVAILABLE:["本地可用","good"],READY_LOCAL:["本地可用","good"],CONFIGURED:["已配置 · 待验证","neutral"],OFFLINE:["离线","bad"],ERROR:["连接异常","bad"],CHECKING:["检查中","working"],NOT_CHECKED:["未验证","neutral"],IDLE:["空闲","neutral"]};
  const PAGE = {home:["工作室总览","查看真实工位状态，按需启动有限任务。"],roles:["角色与接入","选择执行程序与模型，保留统一的工位交接。"],mcp:["MCP 插件","管理本地工具配置与工位归属。"],policy:["运行策略","设置有限调用、保存方式与 API 预算。"],project:["项目设置","为新目标建立独立任务目录。"],logs:["日志记录","查看实际模型、工具与机器验收记录。"],license:["版本与许可","比较真实功能与拟采用的商业规则；销售、支付与设备授权尚未开放。"],about:["关于 AI Studio","当前设备上的本地创作与交接控制面板。"]};
  const store = {state:{jobs:[],connections:{},app:{}},settings:{},settingsLoaded:false,selected:null,view:"home",refreshing:false,previous:new Map(),editingProvider:null,editingMcp:null,credentialProvider:null,approval:null};

  function node(tag, attrs = {}, children = []) { const element = document.createElement(tag); for (const [key,value] of Object.entries(attrs)) { if (value == null) continue; if(key === "text") element.textContent = String(value); else if(key === "class") element.className=value; else if(key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2),value); else if(key === "checked" || key === "disabled") element[key]=Boolean(value); else element.setAttribute(key,String(value)); } for (const child of children) if (child != null) element.append(typeof child === "string" ? document.createTextNode(child) : child); return element; }
  function text(selector, value) { const element = $(selector); if(element) element.textContent = String(value ?? "—"); }
  function toast(message, kind = "") { const item=node("div",{class:"toast "+kind,text:message}); $("#toast-region").append(item); setTimeout(()=>item.remove(),kind === "error" ? 10000 : 5500); }
  function statusInfo(value) { const key=String(value || "UNKNOWN").toUpperCase(); return STATUSES[key] || [String(value || "未验证"),"neutral"]; }
  function badge(status) { const [label,kind]=statusInfo(status); return node("span",{class:"badge "+kind,text:label}); }
  function plain(value) { if(value == null) return ""; if(typeof value === "string") return value; if(typeof value === "object") return String(value.summary || value.detail || value.message || value.action || value.tool || JSON.stringify(value)); return String(value); }
  function truncate(value, count=160) { const content=plain(value); return content.length>count ? content.slice(0,count)+"…" : content; }
  function money(value) { if(value == null || value === "") return "—"; const amount=Number(value); return Number.isFinite(amount) ? "$"+amount.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:5}) : "—"; }
  function providers() { return store.settings.providers || store.settings.registry?.providers || store.settings.workers?.providers || {}; }
  function effectiveModel(provider) { return provider.model || (provider.adapter === "codex" ? store.settings.config?.codex_model : provider.adapter === "claude" ? store.settings.config?.claude_model : null) || ""; }
  function providerRoleReady(provider,role) {
    const required=role === "vfx" ? ["asset-authoring","structured-output"] : role === "research" ? ["web-research","structured-output"] : ["code-edit","structured-output"];
    if(["codex","claude"].includes(provider.adapter) && role !== "research")required.push(role === "vfx" ? "blender-mcp" : "godot-mcp");
    return required.every(capability=>(provider.capabilities || []).includes(capability)) && (provider.ready_roles || []).includes(role);
  }
  function routes() { return store.settings.role_routes || store.settings.registry?.role_routes || store.settings.workers?.role_routes || {}; }
  function policy() { return store.settings.policy || {}; }
  function updatePolicyCapabilities() { const enabled=(store.state.app?.capabilities?.auto_retry ?? store.settings.capabilities?.auto_retry) === true; const form=$("#policy-form"); form.elements.auto_retry.disabled=!enabled; form.elements.max_retries.disabled=!enabled; text("#policy-capability-note",enabled ? "" : "自动返修尚未声明可用，当前保持关闭。"); }
  function jobs() { return Array.isArray(store.state.jobs) ? store.state.jobs : []; }
  function job() { return jobs().find(item=>item.id === store.selected || item.job_id === store.selected) || null; }
  function jobId(item) { return item?.id || item?.job_id || ""; }
  function jobKind(item=job()) { return item?.kind || item?.task?.kind || "fan-wave-demo"; }
  function roleLabel(role,item=job()) { return role === "vfx" && jobKind(item) === "software" ? "设计 / 资源" : role === "gameplay" && jobKind(item) === "software" ? "软件实现" : ROLES[role].label; }
  function stageData(item, stage) { const data=item?.stages || {}; return Array.isArray(data) ? data.find(row=>row.name===stage) || {} : data[stage] || {}; }
  function runningId() { const running=store.state.running_job; return typeof running === "object" ? running?.id || running?.job_id : running; }
  function providerFor(role, item=job()) { const stage=stageData(item,ROLES[role].stage); const actual=stage.provider; const localRoutes=item?.role_routes || routes(); const fallback=Array.isArray(localRoutes[role]) ? localRoutes[role][0] : localRoutes[role]; const id=(typeof actual === "object" ? actual?.provider_id || actual?.id : actual) || fallback; return {id:id || "",...(providers()[id] || {}),...(typeof actual === "object" ? actual : {})}; }
  function budgetFor(item=job()) { return item?.budget || store.state.budgets?.[jobId(item)] || {}; }
  function unresolvedCosts(item=job()) {
    const budget=budgetFor(item), accounting=item?.checkpoint?.accounting || {};
    const entries=budget.invocations || accounting.invocations || {};
    const explicit=new Set([...(budget.unknown_invocations || []),...(budget.interrupted_invocations || [])]);
    const idle=!item?.running && runningId() !== jobId(item);
    const values=Array.isArray(entries) ? entries.map(entry=>[entry.invocation_id || entry.id,entry]) : Object.entries(entries);
    return values.filter(([id,entry])=>id && (entry.state === "unknown" || explicit.has(id) || entry.state === "pending" && idle && (accounting.cost_reconciliation_required || ["PAUSED","INTERRUPTED","WAITING_CONNECTION"].includes(jobStatus(item))))).map(([id,entry])=>({id,...entry}));
  }
  function openReconciliation() {
    const item=job(), entries=unresolvedCosts(item);
    if(!item || !entries.length){toast("当前没有本地服务确认的未知或中断调用需要核对。","error");return;}
    store.reconcileJob=jobId(item);
    const form=$("#reconcile-form"); form.reset();
    form.elements.invocation_id.replaceChildren(...entries.map(entry=>node("option",{value:entry.id,text:entry.id})));
    form.elements.reported_cost_usd.value="";
    form.elements.confirmed_from_usage.checked=false;
    text("#reconcile-invocation-info","仅核对实际用量；已有支出、预留与总预算不会清零。");
    $("#reconcile-dialog").showModal();
  }
  function jobStatus(item) { if(["CANCELLED","CANCELLING","CANCEL_FAILED"].includes(item?.status))return item.status; if(["PAUSING","PAUSED","RESUMING","WAITING_CONNECTION","WAITING_APPROVAL"].includes(item?.status)) return item.status; if(item?.paused) return "PAUSED"; if(stageData(item,"qa").status === "DONE") return "DONE"; const stages=Object.values(item?.stages || {}); if(runningId() === jobId(item) || stages.some(row=>row.status === "RUNNING")) return "RUNNING"; if(stages.some(row=>row.status === "FAILED")) return "FAILED"; if(stages.some(row=>row.status === "BUDGET_STOP")) return "BUDGET_STOP"; if(stages.some(row=>["BLOCKED","INTERRUPTED","WAITING_EXTERNAL","NEEDS_REFERENCE","WAITING_CONNECTION","WAITING_APPROVAL"].includes(row.status))) return stages.find(row=>["BLOCKED","INTERRUPTED","WAITING_EXTERNAL","NEEDS_REFERENCE","WAITING_CONNECTION","WAITING_APPROVAL"].includes(row.status)).status; return item?.status || "READY"; }
  async function api(path, options={}) { const method=options.method || "GET"; const headers={"Accept":"application/json"}; if(method !== "GET") { headers["Content-Type"]="application/json"; headers["X-Studio-Token"]=String(window.STUDIO_TOKEN || ""); } const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),20000); try { const response=await fetch(path,{method,headers,credentials:"same-origin",cache:"no-store",signal:controller.signal,...(options.body !== undefined ? {body:JSON.stringify(options.body)} : {})}); let data; try { data=await response.json(); } catch { throw new Error("本地服务没有返回有效状态，请确认桌面服务已启动。"); } if(!response.ok || data.ok === false) throw new Error(plain(data.error || data.detail || data.message) || "操作失败（"+response.status+"）"); return data.data ?? data; } catch(error) { if(error.name === "AbortError") throw new Error("本地服务响应超时。任务可能仍在执行，请刷新真实状态。"); throw error; } finally { clearTimeout(timer); } }
  async function action(path, body, success) { try { const response=await api(path,{method:"POST",body}); if(success) toast(success,"success"); await refreshState(); return response; } catch(error) { toast(error.message,"error"); return null; } }
  async function withBusy(button, fn) { const old=button.textContent; button.disabled=true; button.textContent="处理中…"; try { return await fn(); } finally { button.textContent=old; button.disabled=false; if(store.view === "home") renderHome(); } }
  function showView(view) { if(!PAGE[view]) return; store.view=view; $$(".view").forEach(item=>item.classList.toggle("active",item.id === "view-"+view)); $$(".nav-item").forEach(item=>item.classList.toggle("active",item.dataset.view===view)); text("#page-title",PAGE[view][0]); text("#page-description",PAGE[view][1]); if(view === "logs") renderLogs(); if(view === "policy") updatePolicyCapabilities(); }
  function connectionFor(id) { const data=store.state.connections || {}; return Array.isArray(data) ? data.find(item=>item.id === id || item.provider_id === id) || {} : data[id] || {}; }
  function renderWorkers() { const item=job(); const container=$("#worker-cards"); container.replaceChildren(...Object.entries(ROLES).map(([role,meta])=>{ const provider=providerFor(role,item), stage=stageData(item,meta.stage), connection=connectionFor(provider.id); const latest=stage.latest_tool_event || stage.tool_event || stage.last_tool || (typeof stage.activity === "object" ? stage.activity?.tool : null); const tail=Array.isArray(stage.log_tail) ? stage.log_tail.at(-1) : stage.log_tail; const activity=stage.activity || stage.detail || (stage.status === "DORMANT" ? "按需唤醒，目前没有模型调用。" : "暂无当前动作"); const displayStatus=stage.status === "RUNNING" ? "RUNNING" : connection.status || "NOT_CHECKED"; return node("article",{class:"worker-card"},[node("div",{class:"worker-header"},[node("span",{class:"role-symbol "+role,text:meta.symbol}),badge(displayStatus)]),node("div",{class:"worker-role",text:roleLabel(role,item)}),node("div",{class:"provider-name",title:provider.id,text:provider.id || "尚未选择执行程序"}),node("div",{class:"worker-model",text:effectiveModel(provider) || (provider.adapter === "codex" ? "ChatGPT 订阅 · 默认模型" : "模型跟随已配置接入")}),node("div",{class:"worker-activity","data-i18n-raw":Boolean(stage.activity || stage.detail),title:plain(activity),text:truncate(activity,115)}),node("div",{class:"worker-event","data-i18n-raw":Boolean(latest || tail),title:plain(latest || tail),text:latest ? "工具事件 · "+truncate(latest,80) : tail ? "最新日志 · "+truncate(tail,80) : "暂无实际工具事件"})]); })); const failed=Object.entries(store.state.connections || {}).filter(([,value])=>["FAILED","OFFLINE","ERROR"].includes(String(value.status).toUpperCase())); const warning=$("#connection-warning"); warning.classList.toggle("hidden",!failed.length); warning.textContent=failed.length ? "连接异常："+failed.map(([id,value])=>id+"（"+truncate(value.detail || value.message || value.status,85)+"）").join("；")+"。其他就绪工位可继续，依赖异常工位的阶段会等待。" : ""; }
  function renderHome() { renderWorkers(); const item=job(), state=jobStatus(item), active=Boolean(runningId()); text("#job-title",item ? jobId(item) : "还没有活动任务"); $("#job-goal").dataset.i18nEmpty=item?.goal || item?.task?.goal ? "false":"true";text("#job-goal",item?.goal || item?.task?.goal || "创建独立任务后，工作室会按依赖顺序交接。"); const [label,kind]=statusInfo(item ? state : "DORMANT"); $("#job-status").className="badge "+kind; text("#job-status",item ? label : "未选择任务"); const flow=$("#stage-flow"); const steps=[["gpt_base","玩法"],["claude_vfx","特效"],["gpt_integrate","整合"],["qa","机器验收"]]; const fragments=[]; steps.forEach(([id,title],index)=>{ const current=stageData(item,id); fragments.push(node("div",{class:"flow-step "+(current.status === "DONE" ? "done" : current.status === "RUNNING" ? "running" : ["FAILED","BLOCKED","BUDGET_STOP"].includes(current.status) ? "failed" : "")},[node("div",{class:"flow-label",text:(jobKind(item) === "software" && id === "gpt_base" ? "实现" : jobKind(item) === "software" && id === "claude_vfx" ? "设计 / 资源" : title)+(index<2 ? " · 并行" : "")}),node("div",{class:"flow-status",text:statusInfo(current.status || "DORMANT")[0]})])); if(index < steps.length-1) fragments.push(node("span",{class:"flow-arrow",text:index===0 ? "+" : "→"})); }); flow.replaceChildren(...fragments); const activeStage=Object.entries(item?.stages || {}).find(([,s])=>s.status === "RUNNING") || Object.entries(item?.stages || {}).find(([,s])=>["FAILED","BLOCKED","BUDGET_STOP","WAITING_EXTERNAL","NEEDS_REFERENCE","WAITING_CONNECTION","WAITING_APPROVAL","PAUSING"].includes(s.status)); text("#job-activity",state === "CANCELLED" ? "本次任务已取消，已生成内容不可恢复；配置与已发生费用保留，可编辑后重新开始。" : activeStage ? truncate(activeStage[1].activity || activeStage[1].detail || statusInfo(activeStage[1].status)[0],300) : state === "DONE" ? "本任务已完成机器验收。可打开交付或查看真实预览。" : "等待本地任务事件；状态刷新不会调用模型。"); $("#start-job").disabled=!item || !store.settingsLoaded || active || state === "DONE" || state === "CANCELLED" || item?.can_start === false; $("#pause-job").disabled=!item || state === "DONE" || state === "PAUSING"; $("#resume-job").disabled=!item || !store.settingsLoaded || active || state === "DONE" || state === "CANCELLED"; const retry=$("#retry-stage"), previous=retry.value; const eligible=Object.entries(item?.stages || {}).filter(([,s])=>["FAILED","BLOCKED","INTERRUPTED"].includes(s.status)); retry.replaceChildren(...(eligible.length ? eligible.map(([id])=>node("option",{value:id,text:Object.values(ROLES).find(role=>role.stage===id)?.label || (id === "qa" ? "机器验收" : id)})) : [node("option",{value:"",text:"没有可重试工位"})])); if(eligible.some(([id])=>id===previous)) retry.value=previous; $("#retry-job").disabled=!item || active || !eligible.length || state === "CANCELLED"; $$("[data-open]").forEach(button=>button.disabled=!item || state === "CANCELLED" || button.dataset.open === "play" && state !== "DONE"); $("#edit-cancelled-task").disabled=!item || state!=="CANCELLED";renderBudget(); renderJobs(); }
  function renderBudget() {
    const budget=budgetFor(), cap=budget.total_cap_usd ?? budget.job_cap_usd ?? budget.budget_usd ?? budget.production_job_threshold ?? budget.limit_usd ?? policy().job_budget_usd;
    const spent=budget.spent_usd ?? budget.estimated_spend_usd ?? budget.production_reported_cost;
    const reserved=budget.reserved_usd ?? (jobStatus(job()) === "DONE" && budget.production_reported_cost != null ? 0 : null);
    const suppliedBalance=budget.available_usd ?? budget.remaining_estimated_usd ?? budget.remaining_usd;
    const historicalBalance=budget.production_reported_cost != null && cap != null ? Math.max(0,Number(cap)-Number(budget.production_reported_cost)) : null;
    $("#budget-total").replaceChildren(document.createTextNode(cap == null ? "—" : money(cap)),node("span",{text:"USD"}));
    text("#budget-spent",money(spent));text("#budget-reserved",money(reserved));text("#budget-available",money(suppliedBalance ?? historicalBalance));
    const unknown=(budget.unknown_invocations || []).length || budget.costs_complete === false && budget.blocked;
    let message=unknown ? "有费用未知或遗留调用记录，API 工位会停止，待核实真实费用。" : budget.blocked ? plain(budget.block_reasons || "预算不足，新的 API 调用已停止。") : "显示本地已记录费用与执行中预留；实际结算以供应商账单为准。";
    if(budget.connection_reported_cost != null) message="另有已记录连接测试费用 "+money(budget.connection_reported_cost)+"。实际结算以供应商账单为准。";
    text("#budget-note",cap == null ? "本任务还没有预算记录。开始 API 工位前会明确确认。" : message);
    $("#budget-note").classList.toggle("danger-text",Boolean(budget.blocked || unknown));
    const button=$("#reconcile-cost"), entries=unresolvedCosts();
    if(button){button.classList.toggle("hidden",!entries.length && !budget.blocked && !job()?.checkpoint?.accounting?.cost_reconciliation_required);button.disabled=!entries.length;button.title=entries.length ? "从供应商真实用量记录核对费用" : "没有本地服务确认的未知调用；不能猜测费用";}
  }
  function renderJobs() {
    const list=$("#job-list"), signature=JSON.stringify([store.selected,jobs().map(item=>({id:jobId(item),goal:item.goal || item.task?.goal,status:jobStatus(item),updated_at:item.updated_at}))]);
    if(store.jobsSignature!==signature || !list.childElementCount) {
      store.jobsSignature=signature;
      list.replaceChildren(...(jobs().length ? jobs().map(item=>node("div",{class:"job-row "+(jobId(item)===store.selected ? "selected" : ""),role:"button",tabindex:"0",onclick:()=>selectJob(jobId(item)),onkeydown:event=>{if(event.key === "Enter" || event.key === " "){event.preventDefault();selectJob(jobId(item));}}},[
        node("span",{class:"job-indicator"}),node("div",{},[node("div",{class:"job-name",text:jobId(item)}),node("div",{class:"job-detail","data-i18n-raw":Boolean(item.goal || item.task?.goal),title:item.goal || item.task?.goal,text:item.goal || item.task?.goal || "独立任务"})]),badge(jobStatus(item)),node("span",{class:"job-attempts",text:item.updated_at ? new Date(typeof item.updated_at === "number" ? item.updated_at*1000 : item.updated_at).toLocaleTimeString("zh-CN",{timeZone:"Asia/Shanghai"}) : ""})
      ])) : [node("div",{class:"empty",text:"暂无任务。创建独立任务后，实际进度会显示在这里。"})]));
    }
    const logJob=$("#log-job"), ids=jobs().map(jobId), logSignature=JSON.stringify(ids);
    if(store.logJobsSignature!==logSignature) {
      store.logJobsSignature=logSignature;
      const old=logJob.value;
      logJob.replaceChildren(...ids.map(id=>node("option",{value:id,text:id})));
      logJob.value=ids.includes(old) ? old : store.selected || "";
    }
  }
  function selectJob(id) { store.selected=id; $("#log-job").value=id; renderHome(); renderLogs(); }
  function roleChecks(container, name, selected=[]) { container.replaceChildren(...Object.entries(ROLES).map(([role,meta])=>node("label",{class:"check-label"},[node("input",{type:"checkbox",name,value:role,checked:selected.includes(role)}),meta.label]))); }
  function roleCapabilities(roles, adapter) { const caps=new Set([...(providers()[store.editingProvider]?.capabilities || []),"structured-output"]); roles.forEach(role=>{if(["gameplay","integration"].includes(role)){caps.add("code-edit");caps.add("story-writing");caps.add("godot-mcp");}if(role === "vfx"){caps.add("asset-authoring");caps.add("blender-mcp");}if(role === "research") caps.add("web-research");}); if(adapter === "manual-desktop") caps.add("manual-handoff"); return [...caps]; }
  function availableAdapters() { const declared=store.settings.available_adapters || store.state.app?.supported_adapters; const values=declared ? (Array.isArray(declared) ? declared : Object.keys(declared)) : Object.keys(ADAPTERS).filter(id=>id!=="openai-compatible-research"); return [...new Set([...values,...Object.values(providers()).map(p=>p.adapter)])].filter(Boolean); }
  const editCancelled=node("button",{id:"edit-cancelled-task",class:"button quiet",text:"编辑新任务"});$("#pause-job").after(editCancelled);editCancelled.addEventListener("click",()=>{const item=job();if(!item || jobStatus(item)!=="CANCELLED")return;store.cancelledTaskEdit=jobId(item);const form=$("#project-form");form.elements.job_id.value=store.cancelledTaskEdit;form.elements.job_id.disabled=true;form.elements.kind.value=jobKind(item);form.elements.goal.value="";form.elements.budget_usd.value=budgetFor(item).cap_usd || budgetFor(item).total_cap_usd || policy().job_budget_usd || 3;$("button[type=submit]",form).textContent="保存新任务";showView("project");});
  function renderSettings() { const roleConfig=$("#role-config"); roleConfig.replaceChildren(...Object.entries(ROLES).map(([role,meta])=>{ const current=routes()[role], selected=Array.isArray(current) ? current[0] : current; const select=node("select",{name:role,"aria-label":meta.label,required:"required"}); select.append(...Object.entries(providers()).filter(([,p])=>providerRoleReady(p,role)).map(([id,p])=>node("option",{value:id,text:id+" · "+(effectiveModel(p) || ADAPTERS[p.adapter] || p.adapter)}))); if(selected) select.value=selected; return node("label",{class:"field"},[node("span",{text:meta.label}),select,node("small",{text:role === "research" ? "按需调用所选研究工位；智能体可在下方增删。" : "执行前仍会核对工具能力、就绪状态与预算。"})]); })); renderProviders(); renderMcp(); const form=$("#policy-form"), settings=policy(); for(const field of ["token_saving","auto_retry","autosave","notify"]) form.elements[field].checked=Boolean(settings[field]); for(const field of ["max_retries","job_budget_usd","connection_budget_usd"]) if(settings[field] != null) form.elements[field].value=settings[field]; const autoSupported=store.state.app?.capabilities?.auto_retry ?? store.settings.capabilities?.auto_retry ?? false; form.elements.auto_retry.disabled=autoSupported === false; form.elements.max_retries.disabled=autoSupported === false; text("#policy-capability-note",autoSupported === false ? "自动返修尚未接入，当前保持关闭。" : ""); if(settings.job_budget_usd != null) $("#project-form").elements.budget_usd.value=settings.job_budget_usd; const details=store.settings.project || {}; $("#workspace-details").replaceChildren(...Object.entries({"工作室目录":details.studio_path || store.state.app?.studio_path || store.state.app?.root,"默认目标":details.goal || "创建新任务时填写","当前任务":store.selected || "未选择"}).map(([label,value])=>node("div",{},[node("dt",{text:label}),node("dd",{text:value || "服务尚未提供"})]))); const app=store.state.app || {}; $("#about-details").replaceChildren(...Object.entries({"桌面版本":app.version || "本地控制面板","运行设备":app.host || app.platform || "当前 Windows 设备","活动任务":runningId() || "无活动模型任务","状态来源":"本地数据库与工位工具日志"}).map(([label,value])=>node("div",{},[node("dt",{text:label}),node("dd",{text:value})]))); }
  function renderProviders() {
    const container=$("#provider-list"), signature=JSON.stringify([providers(),store.state.connections,store.settings.config?.codex_model,store.settings.config?.claude_model]);
    if(store.providerSignature===signature && container.childElementCount) return;
    store.providerSignature=signature;
    const rows=Object.entries(providers()).map(([id,p])=>{
      const connection=connectionFor(id);
      const actions=node("div",{class:"provider-actions"},[
        badge(connection.status || "NOT_CHECKED"),
        node("button",{class:"button small quiet",text:"检查连接",onclick:event=>withBusy(event.currentTarget,()=>checkConnection(id))}),
        node("button",{class:"button small quiet",text:"修改",onclick:()=>openProvider(id)}),
        node("button",{class:"button small danger",text:"移除",onclick:()=>removeProvider(id)})
      ]);
      if(p.adapter === "codex")actions.prepend(node("button",{class:"button small quiet",text:"登录账号",onclick:event=>withBusy(event.currentTarget,()=>action("/api/login",{provider_id:id},"登录流程已交给本地接入；登录或验证需要你本人完成"))}));
      if(p.billing === "metered")actions.prepend(node("button",{class:"button small quiet",text:"设置凭据",onclick:()=>openCredentials(id)}));
      return node("div",{class:"provider-row"},[node("div",{},[
        node("strong",{"data-i18n-raw":"true",text:id}),
        node("div",{class:"provider-meta",text:(ADAPTERS[p.adapter] || p.adapter)+(effectiveModel(p) ? " · "+effectiveModel(p) : "")}),
        node("div",{class:"provider-meta",text:plain(connection.detail) || "未进行真实连接验证"})
      ]),actions]);
    });
    container.replaceChildren(...(rows.length ? rows : [node("div",{class:"empty",text:"还没有登记智能体。添加接入配置后再选择工位。"})]));
  }
  function mcpEntries() { const data=store.settings.mcp || []; return Array.isArray(data) ? data : Object.entries(data).map(([id,entry])=>({id,...entry})); }
  function renderMcp() {
    const rows=mcpEntries().map(entry=>{
      const references=[...new Set([...JSON.stringify(entry.config || {}).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match=>match[1]))];
      const actions=node("div",{class:"provider-actions"},[
        node("label",{class:"check-label"},[node("input",{type:"checkbox",checked:entry.enabled,onchange:async event=>{
          const result=await action("/api/mcp",{action:"update",id:entry.id,entry:{...entry,enabled:event.target.checked}},"MCP 配置已更新");
          if(result) await loadSettings(); else event.target.checked=!event.target.checked;
        }}),entry.enabled ? "已启用配置" : "已停用配置"]),
        ...references.map(name=>node("button",{class:"button small quiet",text:"设置 "+name,onclick:()=>openCredentials("mcp-variable:"+name)})),
        node("button",{class:"button small quiet",text:"配置",onclick:()=>openMcp(entry.id)}),
        node("button",{class:"button small danger",text:"移除",onclick:async()=>{
          if(window.confirm("移除 MCP 配置「"+entry.id+"」？现有素材文件不会删除。")) {
            const response=await action("/api/mcp",{action:"remove",id:entry.id},"MCP 配置已移除");
            if(response) await loadSettings();
          }
        }})
      ]);
      return node("div",{class:"provider-row"},[node("div",{},[
        node("strong",{"data-i18n-raw":"true",text:entry.name || entry.id}),
        node("div",{class:"provider-meta",text:(entry.roles || []).map(role=>ROLES[role]?.label || role).join(" / ") || "未分配工位"}),
        node("div",{class:"provider-meta",text:entry.detail || "配置由本地服务管理，连接状态需实际检查。"}),
        references.length ? node("div",{class:"provider-meta",text:"私有环境变量引用："+references.join("、")}) : null
      ]),actions]);
    });
    $("#mcp-list").replaceChildren(...(rows.length ? rows : [node("div",{class:"empty",text:"暂无 MCP 接入配置。可添加服务或导入 mcpServers JSON。"})]));
  }
  function renderLogs() { const selected=jobs().find(item=>jobId(item) === $("#log-job").value) || job(); const filter=$("#log-filter").value.toLowerCase(), chosen=$("#log-stage").value; const lines=[]; for(const [stage,entry] of Object.entries(selected?.stages || {})) { if(chosen !== "all" && stage !== chosen) continue; const raw=entry.log_tail || entry.logs || []; const tail=Array.isArray(raw) ? raw : String(raw).split("\n"); tail.forEach(line=>{const value=plain(line);if(value && (!filter || value.toLowerCase().includes(filter))) lines.push((chosen === "all" ? "["+stage+"] " : "")+value);}); } const output=$("#log-output");output.dataset.i18nRaw=lines.length?"true":"false"; const content=lines.length ? lines.slice(-500).join("\n") : selected ? "当前筛选条件下暂无真实日志。" : "请选择一个本地任务。"; if(output.textContent !== content) { output.textContent=content; if($("#log-follow").checked) output.scrollTop=output.scrollHeight; } text("#log-caption",(selected ? jobId(selected)+" · " : "")+"本地日志尾部 · 当前显示 "+Math.min(500,lines.length)+" 行 · 不调用模型"); }
  async function loadSettings() { const response=await api("/api/settings"); store.settings=response.settings || response; store.settingsLoaded=true; renderSettings(); renderHome(); }
  async function refreshState() { if(store.refreshing) return; store.refreshing=true; try { const response=await api("/api/state"); store.state=response.state || response;document.dispatchEvent(new CustomEvent("studio:state",{detail:store.state}));document.dispatchEvent(new CustomEvent("studio:public-policy",{detail:store.state.app?.commerce || null})); store.state.jobs=(store.state.jobs || []).map(item=>({...item,stages:Array.isArray(item.stages) ? Object.fromEntries(item.stages.map(stage=>[stage.name,stage])) : item.stages})); if(!store.state.running_job) store.state.running_job=store.state.jobs.find(item=>item.running)?.job_id || store.state.jobs.find(item=>item.running)?.id || null; if(!jobs().some(item=>jobId(item)===store.selected)) store.selected=runningId() || jobId(jobs()[0]) || null; text("#server-status","本地服务已连接"); $("#server-dot").className="status-dot good"; $("#live-dot").className="status-dot good"; text("#last-sync","更新于 "+new Date().toLocaleTimeString("zh-CN",{hour12:false,timeZone:"Asia/Shanghai"})); $("#service-warning").classList.add("hidden"); for(const item of jobs()) for(const [stage,entry] of Object.entries(item.stages || {})) { const id=jobId(item)+":"+stage, old=store.previous.get(id); if(old && old!==entry.status && ["DONE","FAILED","BLOCKED"].includes(entry.status) && policy().notify) toast(jobId(item)+" · "+(Object.values(ROLES).find(role=>role.stage===stage)?.label || stage)+"："+statusInfo(entry.status)[0],entry.status === "DONE" ? "success" : "error"); store.previous.set(id,entry.status); } renderHome(); renderLogs(); updatePolicyCapabilities(); if(store.view === "roles") renderProviders(); } catch(error) { text("#server-status","本地服务暂不可用"); $("#server-dot").className="status-dot bad"; $("#live-dot").className="status-dot bad"; text("#service-warning",error.message+" 已保留上次状态；当前状态可能已过期。"); $("#service-warning").classList.remove("hidden"); } finally { store.refreshing=false; } }
  function openProvider(id=null) { store.editingProvider=id; const form=$("#provider-form"), provider=id ? providers()[id] : {}; form.reset(); form.elements.id.value=id || ""; form.elements.id.disabled=Boolean(id); const adapter=$("#provider-adapter"); adapter.replaceChildren(...availableAdapters().map(value=>node("option",{value,text:ADAPTERS[value] || value}))); adapter.value=provider.adapter || "external-command"; form.elements.model.value=provider.model || ""; form.elements.model.placeholder=effectiveModel(provider) ? "留空继承："+effectiveModel(provider) : "使用已登记的模型名称"; form.elements.billing.value=provider.billing || "metered"; form.elements.command.value=provider.command?.length ? JSON.stringify(provider.command,null,2) : ""; form.elements.settings_ref.value=provider.settings_ref || ""; form.elements.endpoint.value=provider.settings?.endpoint || provider.endpoint || provider.base_url || ""; const selected=provider.ready_roles || (provider.adapter === "openrouter-research" ? ["research"] : ["gameplay","integration"]); roleChecks($("#provider-role-checks"),"roles",selected); text("#provider-dialog-title",id ? "修改智能体 · "+id : "添加智能体"); updateProviderFields(); $("#provider-dialog").showModal(); }
  function updateProviderFields() { const form=$("#provider-form"), adapter=form.elements.adapter.value; if(["codex","kimi"].includes(adapter)) form.elements.billing.value="subscription"; else if(["claude","openrouter-research","openai-compatible-research"].includes(adapter)) form.elements.billing.value="metered"; else if(adapter === "manual-desktop") form.elements.billing.value="manual"; form.elements.billing.disabled=adapter !== "external-command"; $("#provider-command-field").classList.toggle("hidden",!["external-command","kimi"].includes(adapter)); if(adapter === "kimi")form.elements.model.placeholder="留空使用隔离会员配置中的模型，仍需核对认证"; const endpointEnabled=["claude","openai-compatible-research"].includes(adapter); $("#provider-endpoint-field").classList.toggle("hidden",!endpointEnabled); form.elements.endpoint.disabled=!endpointEnabled; form.elements.endpoint.placeholder=adapter === "claude" && store.settings.config?.claude_base_url ? "留空继承："+store.settings.config.claude_base_url : adapter === "claude" ? "https://兼容 Anthropic 的服务地址" : "https://服务地址/v1"; let endpointNote=$("#provider-endpoint-note"); if(!endpointNote){endpointNote=node("small",{id:"provider-endpoint-note"});$("#provider-endpoint-field").append(endpointNote);} endpointNote.textContent=adapter === "claude" ? "需兼容 Anthropic Messages API。留空使用现有默认地址；此处不填写 API 密钥。" : "填写支持的 API 兼容服务地址；密钥请通过设置凭据单独保存。"; if(adapter.includes("research")) $$("input[name=roles]",form).forEach(input=>input.checked=input.value === "research"); }
  async function removeProvider(id) { if(!window.confirm("移除智能体「"+id+"」？如果仍被工位引用，服务会拒绝移除。")) return; const result=await action("/api/providers",{action:"remove",id},"智能体已移除"); if(result) await loadSettings(); }
  function openMcp(id=null) { store.editingMcp=id; const entry=mcpEntries().find(item=>item.id===id) || {}; const form=$("#mcp-form"); form.reset(); form.elements.id.value=id || ""; form.elements.id.disabled=Boolean(id); form.elements.name.value=entry.name || ""; form.elements.enabled.checked=entry.enabled !== false; form.elements.config.value=entry.config ? JSON.stringify(entry.config,null,2) : ""; roleChecks($("#mcp-role-checks"),"roles",entry.roles || []); text("#mcp-dialog-title",id ? "配置 MCP · "+id : "添加 MCP 插件"); $("#mcp-dialog").showModal(); }
  function openCredentials(id) {
    store.credentialProvider=id;
    $("#credential-form").reset();
    const variable=id.startsWith("mcp-variable:");
    text("#credential-label",variable ? "私有环境变量值" : "API Key / Token");
    text("#credential-provider",(variable ? "MCP 变量："+id.slice(13) : "智能体："+id)+"。保存凭据不会启动模型。");
    $("#credential-dialog").showModal();
  }
  async function checkConnection(id) { const result=await action("/api/connections/check",{provider_id:id,check:"local",approve_paid:false},"本地接入检查已完成"); if(result?.requires_paid_confirmation) openApproval("connection",id); }
  function openApproval(actionName, providerId=null) { const item=job(); if(actionName !== "connection" && !item){toast("请先选择或创建独立任务。","error");return;} const chosen=actionName === "connection" ? [{id:providerId,...providers()[providerId]}] : [...new Map(Object.keys(ROLES).map(role=>{const p=providerFor(role,item);return [p.id,p];}).filter(([id])=>id)).values()]; store.approval={action:actionName,job_id:jobId(item),provider_id:providerId,stage:actionName === "retry" ? $("#retry-stage").value : null,providers:chosen}; text("#approval-title",actionName === "connection" ? "确认一次连接测试" : actionName === "retry" ? "确认重试失败工位" : actionName === "resume" ? "确认恢复任务" : "确认开始任务"); text("#approval-description",actionName === "connection" ? "此测试可能向「"+providerId+"」发送一次模型请求。请确认所选接入与连接测试预算。" : "任务「"+jobId(item)+"」将使用以下工位接入。请确认具体 API 工位与本次总预算；已有支出不会重置。"); const cap=budgetFor(item).total_cap_usd ?? policy().job_budget_usd ?? 3; $("#approval-job-budget").value=cap; $("#approval-connection-budget").value=policy().connection_budget_usd ?? 0.2; $("#approval-paid").checked=false; $("#approval-provider-list").replaceChildren(...chosen.map(p=>{const paid=p.billing === "metered";return node("label",{class:"approval-provider"},[node("input",{type:"checkbox",name:"approve_provider",value:p.id,checked:!paid,disabled:!paid}),node("span",{},[document.createTextNode(p.id),node("small",{text:(effectiveModel(p) || ADAPTERS[p.adapter] || p.adapter || "已选接入")+" · "+(paid ? "API 用量" : p.billing === "manual" ? "桌面人工交接" : "订阅额度")})])]);})); text("#approval-confirm",actionName === "connection" ? "确认一次测试" : actionName === "retry" ? "确认重试" : "确认并"+(actionName === "resume" ? "恢复" : "开始")); $("#approval-dialog").showModal(); }

  document.addEventListener("click",event=>{const view=event.target.closest("[data-view]");if(view) showView(view.dataset.view); const close=event.target.closest("[data-close]");if(close) close.closest("dialog").close();const open=event.target.closest("[data-open]");if(open && job()) withBusy(open,()=>action("/api/job/open",{job_id:jobId(job()),target:open.dataset.open}));});
  $$("dialog").forEach(dialog=>dialog.addEventListener("close",()=>{if(dialog.id === "credential-dialog") $("#credential-form").elements.secret.value="";}));
  $("#refresh-state").addEventListener("click",event=>withBusy(event.currentTarget,async()=>{await refreshState();try{await loadSettings();}catch(error){toast(error.message,"error");}}));
  $("#start-job").addEventListener("click",()=>openApproval("start")); $("#resume-job").addEventListener("click",()=>openApproval("resume"));
  $("#pause-job").addEventListener("click",event=>withBusy(event.currentTarget,()=>action("/api/job/pause",{job_id:jobId(job()),save:true},"已发送暂停并保存请求；请以实际工位状态为准")));
  $("#retry-job").addEventListener("click",()=>openApproval("retry"));
  $("#roles-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget, values={};Object.keys(ROLES).forEach(role=>values[role]=role === "research" ? [form.elements[role].value].filter(Boolean) : form.elements[role].value);await withBusy($("button[type=submit]",form),async()=>{const result=await action("/api/settings",{role_routes:values},"默认工位选择已保存");if(result) await loadSettings();});});
  $("#policy-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget, next={};for(const name of ["token_saving","auto_retry","autosave","notify"])next[name]=form.elements[name].checked;next.max_retries=Math.max(0,Math.min(2,Number(form.elements.max_retries.value)));next.job_budget_usd=Number(form.elements.job_budget_usd.value);next.connection_budget_usd=Number(form.elements.connection_budget_usd.value);await withBusy($("button[type=submit]",form),async()=>{const response=await action("/api/settings",{policy:next},"运行策略已保存");if(response) await loadSettings();});});
  $("#project-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget;await withBusy($("button[type=submit]",form),async()=>{const id=form.elements.job_id.value.trim();const editing=store.cancelledTaskEdit===id;const response=await action(editing?"/api/job/update":"/api/job/create",{job_id:id,goal:form.elements.goal.value.trim(),budget_usd:Number(form.elements.budget_usd.value),task_patch:{kind:form.elements.kind.value}},editing?"新任务已保存；模型未启动，请再次确认开始与费用。":"独立任务已创建，模型尚未启动");if(response){store.cancelledTaskEdit=null;form.elements.job_id.disabled=false;}if(response){store.selected=response.job?.id || response.job_id || response.id || id;await refreshState();showView("home");}});});
  $("#add-provider").addEventListener("click",()=>openProvider()); $("#provider-adapter").addEventListener("change",updateProviderFields);
  $("#provider-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget;await withBusy($("button[type=submit]",form),async()=>{try{const id=store.editingProvider || form.elements.id.value.trim(), adapter=form.elements.adapter.value, selected=$$("input[name=roles]:checked",form).map(input=>input.value);if(!selected.length)throw new Error("请选择至少一个逻辑工位。");const original=store.editingProvider ? providers()[id] : {};const spec={...original,adapter,billing:form.elements.billing.value,model:form.elements.model.value.trim() || null,settings_ref:form.elements.settings_ref.value.trim() || null,ready_roles:selected,capabilities:roleCapabilities(selected,adapter)};if(["external-command","kimi"].includes(adapter))spec.command=JSON.parse(form.elements.command.value || (adapter === "kimi" ? '["kimi"]' : "[]"));else if(adapter === "manual-desktop" || adapter.includes("research"))spec.command=[];else spec.command=original.command || [adapter];const payload={action:store.editingProvider ? "update" : "add",id,provider:spec};if(["claude","openai-compatible-research"].includes(adapter))spec.settings={...(original.settings || {}),endpoint:form.elements.endpoint.value.trim()};const result=await action("/api/providers",payload,"智能体配置已保存；未启动模型");if(result){$("#provider-dialog").close();await loadSettings();}}catch(error){toast(error.message,"error");}});});
  $("#add-mcp").addEventListener("click",()=>openMcp()); $("#import-mcp").addEventListener("click",()=>{$("#mcp-import-form").reset();$("#import-dialog").showModal();});
  $("#mcp-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget;await withBusy($("button[type=submit]",form),async()=>{try{const id=store.editingMcp || form.elements.id.value.trim(),entry={id,name:form.elements.name.value.trim(),enabled:form.elements.enabled.checked,roles:$$("input[name=roles]:checked",form).map(input=>input.value),config:JSON.parse(form.elements.config.value)};const result=await action("/api/mcp",{action:store.editingMcp ? "update" : "add",id,entry},"MCP 配置已保存");if(result){$("#mcp-dialog").close();await loadSettings();}}catch(error){toast("MCP 配置错误："+error.message,"error");}});});
  $("#mcp-import-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget;await withBusy($("button[type=submit]",form),async()=>{try{const config=JSON.parse(form.elements.config.value);const result=await action("/api/mcp",{action:"import",config},"MCP JSON 已导入");if(result){$("#import-dialog").close();await loadSettings();}}catch(error){toast("JSON 无效："+error.message,"error");}});});
  $("#credential-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget;await withBusy($("button[type=submit]",form),async()=>{try{await api("/api/credentials",{method:"POST",body:{provider_id:store.credentialProvider,secret:form.elements.secret.value,remember:form.elements.remember.checked}});form.elements.secret.value="";$("#credential-dialog").close();toast("凭据已交给本地私有接入服务；未启动模型","success");await refreshState();}catch{form.elements.secret.value="";toast("凭据保存失败，请检查本地接入服务后重新输入。","error");}});});
  $("#approval-form").addEventListener("submit",async event=>{event.preventDefault();const approval=store.approval;if(!approval)return;const approved=$("#approval-paid").checked;const selected=$$("input[name=approve_provider]:checked",event.currentTarget).map(input=>input.value);const paid=approval.providers.filter(p=>p.billing === "metered" && selected.includes(p.id)).map(p=>p.id);if(approval.action === "connection" && (!approved || !paid.length)){toast("连接模型测试需要勾选该 API 接入，并明确批准测试预算。","error");return;}if(approved && approval.providers.some(p=>p.billing === "metered") && !paid.length){toast("请选择本次批准的 API 智能体，或取消 API 批准仅运行订阅工位。","error");return;}const paid_approval={approved,providers:approved ? paid : [],job_budget_usd:Number($("#approval-job-budget").value),connection_budget_usd:Number($("#approval-connection-budget").value)};await withBusy($("#approval-confirm"),async()=>{const path=approval.action === "connection" ? "/api/connections/check" : "/api/job/"+approval.action;const body=approval.action === "connection" ? {provider_id:approval.provider_id,test_model:true,paid_approval} : {job_id:approval.job_id,paid_approval,...(approval.stage ? {stage:approval.stage} : {})};const response=await action(path,body,approval.action === "connection" ? "已执行明确批准的连接测试" : "执行请求已提交，请查看真实工位状态");if(response)$("#approval-dialog").close();});});
  ["#log-job","#log-stage","#log-filter"].forEach(selector=>$(selector).addEventListener(selector === "#log-filter" ? "input" : "change",renderLogs));
  $("#copy-logs").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("#log-output").textContent);toast("当前显示日志已复制","success");}catch{toast("无法访问剪贴板，可选中日志手动复制。","error");}});
  $(".budget-panel").append(node("button",{id:"reconcile-cost",class:"button quiet wide hidden",text:"核对未知 / 中断费用",onclick:openReconciliation}));
  $("#reconcile-form").addEventListener("submit",async event=>{
    event.preventDefault(); const form=event.currentTarget;
    const raw=form.elements.reported_cost_usd.value.trim(), id=form.elements.invocation_id.value;
    if(!raw || !Number.isFinite(Number(raw)) || Number(raw)<0 || !form.elements.confirmed_from_usage.checked){toast("请输入已从供应商用量记录确认的非负费用，并勾选确认。","error");return;}
    const selected=jobs().find(item=>jobId(item)===store.reconcileJob);
    if(!unresolvedCosts(selected).some(entry=>entry.id===id)){toast("此调用已不在待核对列表，请刷新实际状态。","error");return;}
    await withBusy($("button[type=submit]",form),async()=>{
      const response=await action("/api/job/reconcile",{job_id:store.reconcileJob,invocation_id:id,reported_cost_usd:raw,confirmed_from_usage:true},"实际费用已核对；原任务预算与已记录支出保留");
      if(response)$("#reconcile-dialog").close();
    });
  });

  // Nonsecret catalog and explicit configuration registration only.
  let assistantTemplates=[];
  function selectedAssistantTemplate(){return assistantTemplates.find(item=>item.id===$('#assistant-template-select').value);}
  function renderAssistantTemplate(){
    const template=selectedAssistantTemplate(), details=$('#assistant-template-details');details.replaceChildren();
    if(!template)return;
    const provider=template.provider || {}, verification=template.verification || {};
    details.append(node('strong',{text:template.label || template.id}),node('p',{text:provider.adapter==='manual-desktop'?'本轮使用桌面人工交接：生成任务包，由你在原助手内完成后回交；不承诺自动操作其界面。':provider.adapter==='kimi'?'Kimi 原生 CLI · 本轮仅会员 Managed OAuth；会员额度不计入美元预算，不接 API Key 计费 profile。':'原生助手/工具接入，以模板实际能力为准。'}));
    const requirements=Array.isArray(template.requirements)?template.requirements:[];
    if(requirements.length)details.append(node('ul',{},requirements.map(value=>node('li',{text:String(value)}))));
    details.append(node('p',{class:'muted',text:verification.status==='cli_help_verified'?'本机CLI与help已核验；未调用模型，模型制作与MCP端到端尚未实测。':'验证状态：'+plain(verification)}));
    if(template.registration_enabled===false)details.append(node('p',{text:'此模板仅提供接入说明，尚需配置/核对；本轮不能一键登记为可运行工位。'}));
    let id=template.suggested_provider_id || template.id || 'assistant-own',count=2,base=id;
    while(providers()[id])id=base+'-'+count++;
    $('#assistant-template-provider-id').value=id;
    $('#assistant-template-provider-id').disabled=template.registration_enabled===false;
    $('#assistant-template-add').disabled=template.registration_enabled===false;
  }
  async function openAssistantTemplates(){
    try{
      const response=await api('/api/assistant/templates');assistantTemplates=response.templates || [];
      if(!Array.isArray(assistantTemplates)||!assistantTemplates.length)throw new Error('本地尚未提供已核实的助手模板。可使用原添加智能体入口，或查看接入说明书。');
      $('#assistant-template-select').replaceChildren(...assistantTemplates.map(item=>node('option',{value:item.id,text:item.label || item.id})));
      renderAssistantTemplate();$('#assistant-template-dialog').showModal();$('#assistant-template-select').focus();
    }catch(error){toast(error.message,'error');}
  }
  $('#add-assistant-template')?.addEventListener('click',openAssistantTemplates);
  $('#assistant-template-select')?.addEventListener('change',renderAssistantTemplate);
  $('#assistant-template-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const template=selectedAssistantTemplate();
    if(!template||template.registration_enabled===false){toast('此模板尚需设置，不能直接登记运行。','error');return;}
    const id=$('#assistant-template-provider-id').value.trim();
    if(providers()[id]){toast('此编号已存在，请换一个新编号，现有配置不会被覆盖。','error');return;}
    await withBusy($('#assistant-template-add'),async()=>{
      const spec=JSON.parse(JSON.stringify(template.provider || {}));
      if(template.settings && Object.keys(template.settings).length)spec.settings={...(spec.settings || {}),...template.settings};
      const result=await action('/api/providers',{action:'add',id,provider:spec},'已登记助手配置；未登录、未启动模型。请按模板要求核对接入。');
      if(result){$('#assistant-template-dialog').close();await loadSettings();}
    });
  });

  showView("home"); renderHome();
  Promise.allSettled([refreshState(),loadSettings()]).then(results=>{const failed=results.find(result=>result.status === "rejected");if(failed)toast("配置读取失败："+failed.reason.message,"error");});
  setInterval(()=>{if(!document.hidden)refreshState();},2000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshState();});
})();
