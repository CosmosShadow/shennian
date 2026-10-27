export type ChinaAreaCodeOption = {
  code: string;
  name: string;
  keywords: string[];
};

export const CHINA_AREA_CODES: ChinaAreaCodeOption[] = [
  { code: "110000", name: "北京市", keywords: ["北京", "beijing"] },
  { code: "120000", name: "天津市", keywords: ["天津", "tianjin"] },
  { code: "130000", name: "河北省", keywords: ["河北", "hebei"] },
  { code: "140000", name: "山西省", keywords: ["山西", "shanxi"] },
  { code: "150000", name: "内蒙古自治区", keywords: ["内蒙古", "neimenggu", "inner mongolia"] },
  { code: "210000", name: "辽宁省", keywords: ["辽宁", "liaoning"] },
  { code: "220000", name: "吉林省", keywords: ["吉林", "jilin"] },
  { code: "230000", name: "黑龙江省", keywords: ["黑龙江", "heilongjiang"] },
  { code: "310000", name: "上海市", keywords: ["上海", "shanghai"] },
  { code: "320000", name: "江苏省", keywords: ["江苏", "jiangsu"] },
  { code: "330000", name: "浙江省", keywords: ["浙江", "zhejiang"] },
  { code: "340000", name: "安徽省", keywords: ["安徽", "anhui"] },
  { code: "350000", name: "福建省", keywords: ["福建", "fujian"] },
  { code: "360000", name: "江西省", keywords: ["江西", "jiangxi"] },
  { code: "370000", name: "山东省", keywords: ["山东", "shandong"] },
  { code: "410000", name: "河南省", keywords: ["河南", "henan"] },
  { code: "420000", name: "湖北省", keywords: ["湖北", "hubei"] },
  { code: "430000", name: "湖南省", keywords: ["湖南", "hunan"] },
  { code: "440000", name: "广东省", keywords: ["广东", "guangdong"] },
  { code: "450000", name: "广西壮族自治区", keywords: ["广西", "guangxi"] },
  { code: "460000", name: "海南省", keywords: ["海南", "hainan"] },
  { code: "500000", name: "重庆市", keywords: ["重庆", "chongqing"] },
  { code: "510000", name: "四川省", keywords: ["四川", "sichuan"] },
  { code: "520000", name: "贵州省", keywords: ["贵州", "guizhou"] },
  { code: "530000", name: "云南省", keywords: ["云南", "yunnan"] },
  { code: "540000", name: "西藏自治区", keywords: ["西藏", "xizang", "tibet"] },
  { code: "610000", name: "陕西省", keywords: ["陕西", "shaanxi", "shanxi"] },
  { code: "620000", name: "甘肃省", keywords: ["甘肃", "gansu"] },
  { code: "630000", name: "青海省", keywords: ["青海", "qinghai"] },
  { code: "640000", name: "宁夏回族自治区", keywords: ["宁夏", "ningxia"] },
  { code: "650000", name: "新疆维吾尔自治区", keywords: ["新疆", "xinjiang"] },
];

export function findChinaAreaByCode(code: string): ChinaAreaCodeOption | null {
  return CHINA_AREA_CODES.find((item) => item.code === code) ?? null;
}

export function findChinaAreaByRegion(region: string | null | undefined): ChinaAreaCodeOption | null {
  const normalized = String(region || "").trim().toLowerCase();
  if (!normalized) return null;
  return CHINA_AREA_CODES.find((item) => item.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) ?? null;
}
