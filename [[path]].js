/**
 * Cloudflare Pages Function: 处理 /api/* 所有路由
 * 需在 Pages 设置中绑定：环境变量 DASHSCOPE_API_KEY，KV 命名空间 CASES_KV
 */
import teachersData from '../teachers-data.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MODEL = 'qwen-turbo';
const TEMPERATURE = 0.7;
const MAX_TOKENS = 2000;
const DASH_API = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function exactMatch(teachersData, direction, position) {
  return teachersData.filter(t => {
    if (!t.direction) return false;
    const dirs = (t.direction || '').split(/[、，,、\/]/).map(d => d.trim());
    const ok = dirs.some(d => d.includes(direction) || direction.includes(d));
    if (!ok) return false;
    if (position && position.trim()) {
      const tp = (t.position || '').toLowerCase();
      const tc = (t.company || '').toLowerCase();
      const sp = position.toLowerCase().trim();
      return tp.includes(sp) || sp.includes(tp) ||
        (sp.includes('互联网') && (tc.includes('互联网') || tc.includes('科技') || tc.includes('软件'))) ||
        (sp.includes('金融') && (tc.includes('金融') || tc.includes('银行') || tc.includes('证券'))) ||
        (sp.includes('快消') && (tc.includes('快消') || tc.includes('消费')));
    }
    return true;
  });
}

async function callDashScope(apiKey, messages, temperature = TEMPERATURE, max_tokens = MAX_TOKENS) {
  const res = await fetch(DASH_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-DashScope-Token': apiKey
    },
    body: JSON.stringify({
      model: MODEL,
      input: { messages },
      parameters: { temperature, max_tokens }
    })
  });
  return res.json();
}

export async function onRequestGet(context) {
  const path = context.params.path || '';
  const env = context.env || {};
  const kv = env.CASES_KV;

  if (path === 'cases') {
    if (!kv) return json({ success: true, cases: [], count: 0 });
    const list = await kv.list({ prefix: 'case:' });
    const cases = [];
    for (const k of list.keys) {
      const raw = await kv.get(k.name);
      if (raw) {
        try {
          const d = JSON.parse(raw);
          cases.push({
            id: d.id,
            timestamp: d.timestamp,
            teacher: d.teacher?.name || '未知导师',
            direction: d.direction || '',
            preview: d.case ? d.case.substring(0, 100) + '...' : ''
          });
        } catch (_) {}
      }
    }
    cases.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return json({ success: true, cases, count: cases.length });
  }

  if (path.startsWith('cases/')) {
    const id = path.slice(6);
    if (!id) return json({ success: false, error: '缺少案例ID' }, 400);
    if (!kv) return json({ success: false, error: '案例不存在' }, 404);
    const raw = await kv.get('case:' + id);
    if (!raw) return json({ success: false, error: '案例不存在' }, 404);
    try {
      const caseData = JSON.parse(raw);
      return json({ success: true, case: caseData });
    } catch (_) {
      return json({ success: false, error: '案例数据异常' }, 500);
    }
  }

  return json({ success: false, error: 'Not Found' }, 404);
}

export async function onRequestPost(context) {
  const path = context.params.path || '';
  const env = context.env || {};
  const apiKey = env.DASHSCOPE_API_KEY;
  const kv = env.CASES_KV;

  if (path === 'match-teachers') {
    let body;
    try {
      body = await context.request.json();
    } catch (_) {
      return json({ success: false, error: '请求体无效' }, 400);
    }
    const { direction, position } = body || {};
    if (!direction) return json({ success: false, error: '请提供求职方向' }, 400);

    const teachers = Array.isArray(teachersData) ? teachersData : [];
    const exact = exactMatch(teachers, direction, position || '');
    let selected = exact.slice(0, 5).map(t => ({
      ...t,
      match_type: 'exact',
      match_score: 100,
      match_reason: '公司和岗位信息与求职需求完全匹配'
    }));

    if (selected.length < 5 && apiKey) {
      const selectedNames = selected.map(t => t.name);
      const candidates = teachers.filter(t => !selectedNames.includes(t.name));
      const need = 5 - selected.length;
      const prompt = `请根据以下求职需求，从候选导师中筛选出最适合的${need}位导师，并按照匹配度从高到低排序。
求职方向：${direction}
求职岗位：${position || '未指定'}
候选导师信息：
${candidates.slice(0, 30).map((t, i) => `导师${i}：姓名${t.name}，公司${t.company || ''}，职位${t.position || ''}，方向${t.direction || ''}`).join('\n')}
请严格按照以下JSON格式返回，只返回JSON：{"teachers":[{"index":0,"match_score":90,"match_reason":"理由"}]}
只返回最适合的${need}位，按匹配度从高到低排序。`;
      const data = await callDashScope(apiKey, [{ role: 'user', content: prompt }], 0.3, 2000);
      if (data.output?.text) {
        try {
          let text = data.output.text.trim().replace(/```json?\n?/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(text);
          if (parsed.teachers && Array.isArray(parsed.teachers)) {
            const aiSelected = parsed.teachers
              .filter(item => item.index >= 0 && item.index < candidates.length)
              .slice(0, need)
              .map(item => ({
                ...candidates[item.index],
                match_type: 'ai',
                match_score: item.match_score || 0,
                match_reason: item.match_reason || 'AI分析推荐'
              }));
            selected = [...selected, ...aiSelected];
          }
        } catch (_) {}
      }
      if (selected.length < 5) {
        const names = selected.map(t => t.name);
        const fallback = candidates.filter(t => !names.includes(t.name)).slice(0, 5 - selected.length)
          .map(t => ({ ...t, match_type: 'fallback', match_score: 50, match_reason: '备选推荐' }));
        selected = [...selected, ...fallback];
      }
    }
    selected = selected.slice(0, 5);
    return json({ success: true, teachers: selected, count: selected.length });
  }

  if (path === 'generate-case') {
    if (!apiKey) return json({ success: false, error: '未配置通义千问 API Key' }, 500);
    let body;
    try {
      body = await context.request.json();
    } catch (_) {
      return json({ success: false, error: '请求体无效' }, 400);
    }
    const { teacher, direction, position, customer_problems, highlights } = body || {};
    if (!teacher) return json({ success: false, error: '请提供老师信息' }, 400);

    const problemDescriptions = {
      interview: '面试碰壁，多次在面试环节被淘汰',
      exam: '笔试碰壁，技术测试或笔试环节表现不佳',
      resume: '简历投递无反馈，投递了大量简历但石沉大海',
      career: '职业规划不明确，不知道自己的优势和适合的方向'
    };
    const customerProblemsDescription = (customer_problems || []).map(p => problemDescriptions[p] || p).join('、') || '未指定';

    const prompt = `请根据以下信息生成一份留学生求职案例报告，用于促单展示。
导师信息：姓名${teacher.name}，公司${teacher.company || ''}，职位${teacher.position || ''}，方向${teacher.direction || ''}，教育${teacher.education || ''}，介绍${(teacher.information || '').slice(0, 500)}
客户求职信息：求职方向${direction || '未指定'}，岗位${position || ''}，客户问题${customerProblemsDescription}，突出内容${highlights || ''}
请生成报告，严格分为【第一部分：背景介绍】和【第二部分：成功故事】，约500字故事，语言专业严谨有感染力，直接输出内容不要额外标题。`;

    const data = await callDashScope(apiKey, [{ role: 'user', content: prompt }]);
    let generatedCase = null;
    if (data.output?.text) generatedCase = data.output.text.trim();
    else if (data.output?.choices?.[0]?.message?.content) generatedCase = data.output.choices[0].message.content.trim();

    if (!generatedCase) {
      const err = data.message || data.error?.message || '无法解析 API 响应';
      return json({ success: false, error: '通义千问 API 调用失败: ' + err }, 500);
    }

    const caseId = Date.now().toString();
    const timestamp = new Date().toISOString();
    const caseData = {
      id: caseId,
      timestamp,
      teacher,
      direction: direction || '',
      position: position || '',
      customer_problems: customer_problems || [],
      highlights: highlights || '',
      case: generatedCase
    };
    if (kv) await kv.put('case:' + caseId, JSON.stringify(caseData));

    return json({ success: true, case: generatedCase, caseId, timestamp });
  }

  if (path === 'save-case') {
    let body;
    try {
      body = await context.request.json();
    } catch (_) {
      return json({ success: false, error: '请求体无效' }, 400);
    }
    const { caseId: id, case: caseContent, teacher, direction, position, customer_problems, highlights } = body || {};
    if (!caseContent) return json({ success: false, error: '案例内容不能为空' }, 400);
    const caseId = id || Date.now().toString();
    const timestamp = new Date().toISOString();
    const caseData = {
      id: caseId,
      timestamp,
      teacher: teacher || {},
      direction: direction || '',
      position: position || '',
      customer_problems: customer_problems || [],
      highlights: highlights || '',
      case: caseContent
    };
    if (kv) await kv.put('case:' + caseId, JSON.stringify(caseData));
    return json({ success: true, message: '案例保存成功', caseId, timestamp });
  }

  return json({ success: false, error: 'Not Found' }, 404);
}

export async function onRequestDelete(context) {
  const path = context.params.path || '';
  const env = context.env || {};
  const kv = env.CASES_KV;

  if (path.startsWith('cases/')) {
    const id = path.slice(6);
    if (!id) return json({ success: false, error: '缺少案例ID' }, 400);
    if (kv) await kv.delete('case:' + id);
    return json({ success: true, message: '案例删除成功' });
  }

  return json({ success: false, error: 'Not Found' }, 404);
}
