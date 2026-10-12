import styled from 'styled-components';

export const StyledDashboard = styled.div`
  min-height: 100vh;
  padding: 28px 40px 64px;
  box-sizing: border-box;
  color: ${props => props.theme.colorText || '#1f1f1f'};

  .dashboard-header {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 4px;
  }
  .dashboard-title {
    font-size: 26px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .dashboard-meta {
    font-size: 13px;
    opacity: 0.5;
  }
  .dashboard-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  /* 顶部那一行使用统计：细、安静，但是在那儿 */
  .dashboard-shame {
    margin: -4px 0 10px;
    padding-bottom: 8px;
    border-bottom: 1px dashed ${props => props.theme.colorBorderSecondary || '#ececec'};
    font-size: 12px;
    opacity: 0.7;

    strong {
      font-weight: 600;
      color: ${props => props.theme.colorError || '#cf1322'};
    }
  }
  .dashboard-status {
    font-size: 12px;
    opacity: 0.55;
    margin-bottom: 28px;
    min-height: 18px;
  }
  .dashboard-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 60vh;
    text-align: center;
  }
`;

export const StyledSection = styled.section<{ $color: string }>`
  margin-bottom: 38px;

  .section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }
  .section-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: ${props => props.$color};
    flex-shrink: 0;
  }
  .section-name {
    font-size: 17px;
    font-weight: 600;
    margin: 0;
  }
  .section-count {
    font-size: 13px;
    opacity: 0.45;
  }
  .section-rule {
    flex: 1;
    height: 1px;
    background: ${props => props.theme.colorBorderSecondary || '#ececec'};
  }
  .section-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(214px, 1fr));
    gap: 12px;
  }
`;

export const StyledTabCard = styled.a`
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-height: 62px;
  padding: 13px 14px;
  border: 1px solid ${props => props.theme.colorBorderSecondary || '#ececec'};
  border-radius: 10px;
  background: ${props => props.theme.colorBgContainer || '#fff'};
  color: inherit;
  text-decoration: none;
  transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s;

  &:hover {
    color: inherit;
    border-color: ${props => props.theme.colorPrimaryBorder || '#c9c9c9'};
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.07);
    transform: translateY(-1px);
  }

  /* 删除按钮平时隐藏，悬停在卡片上或自身获得焦点时才出现 */
  .card-close {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: ${props => props.theme.colorTextTertiary || '#999'};
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }

  &:hover .card-close,
  .card-close:focus-visible {
    opacity: 1;
  }

  .card-close:hover {
    background: ${props => props.theme.colorErrorBg || '#fff1f0'};
    color: ${props => props.theme.colorError || '#cf1322'};
  }

  /* 给标题留出删除按钮的位置，避免文字被盖住 */
  &:hover .card-title {
    padding-right: 16px;
  }

  img {
    width: 16px;
    height: 16px;
    margin-top: 1px;
    flex-shrink: 0;
    border-radius: 3px;
  }

  .card-title {
    font-size: 13px;
    line-height: 1.38;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
`;

// 首屏"重点关注"：比普通分类更醒目，放在所有分类之前
export const StyledPicks = styled.div`
  margin-bottom: 30px;
  padding: 18px 20px 6px;
  border: 1px solid ${props => props.theme.colorBorderSecondary || '#ececec'};
  border-radius: 14px;
  background: ${props => props.theme.colorFillQuaternary || '#fafafa'};

  .picks-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 14px;
  }

  .picks-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .picks-hint {
    font-size: 12px;
    opacity: 0.55;
  }

  .picks-target {
    margin-bottom: 16px;
  }

  .picks-target-name {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.6;
  }

  .picks-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(214px, 1fr));
    gap: 12px;
  }

  /* 标题 + 理由竖排；min-width: 0 是为了让标题能正常截断 */
  .card-body {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  /* 模型给的理由长度不受控，截到 3 行，免得卡片被撑得忽高忽低 */
  .card-reason {
    margin-top: 5px;
    font-size: 11px;
    line-height: 1.35;
    opacity: 0.62;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
`;
