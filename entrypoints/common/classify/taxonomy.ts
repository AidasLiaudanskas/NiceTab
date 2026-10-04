// 标签页自动分类 - 分类清单
export interface CategoryDef {
  id: string;
  name: string;
  hint: string;
  color: string;
}

// 分类清单（顺序即仪表盘展示顺序）
export const CATEGORIES: CategoryDef[] = [
  {
    id: 'job-search',
    name: 'Job Search',
    hint: 'job postings, company careers pages, applications, recruiters, CV/resume tools, interview prep',
    color: '#d4380d',
  },
  {
    id: 'shopping',
    name: 'Shopping',
    hint: 'product pages, listings, carts, price comparisons, marketplaces, reviews of things to buy',
    color: '#d46b08',
  },
  {
    id: 'reading',
    name: 'Reading',
    hint: 'articles, blog posts, long-form writing, news, newsletters saved to read later',
    color: '#096dd9',
  },
  {
    id: 'learning',
    name: 'Learning',
    hint: 'courses, tutorials, documentation being studied, how-to guides, academic papers',
    color: '#531dab',
  },
  {
    id: 'work',
    name: 'Work',
    hint: 'issue trackers, pull requests, dashboards, internal tools, docs and sheets being worked on',
    color: '#08979c',
  },
  {
    id: 'finance',
    name: 'Finance',
    hint: 'banking, investments, tax, invoices, insurance, subscriptions and billing',
    color: '#389e0d',
  },
  {
    id: 'travel',
    name: 'Travel',
    hint: 'flights, hotels, bookings, maps and itineraries, visa and destination research',
    color: '#c41d7f',
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    hint: 'video, music, games, social feeds, humour, anything opened purely for fun',
    color: '#7cb305',
  },
  {
    id: 'other',
    name: 'Other',
    hint: 'genuinely does not fit any category above',
    color: '#8c8c8c',
  },
];

export const OTHER_CATEGORY_ID = 'other';
// 未分类（还没跑过分类器）
export const UNCLASSIFIED_ID = 'unclassified';

export const CATEGORY_IDS = CATEGORIES.map(c => c.id);

export const categoryById = (id: string): CategoryDef =>
  CATEGORIES.find(c => c.id === id) || {
    id: UNCLASSIFIED_ID,
    name: 'Unclassified',
    hint: '',
    color: '#bfbfbf',
  };

export default { name: 'classify-taxonomy' };
