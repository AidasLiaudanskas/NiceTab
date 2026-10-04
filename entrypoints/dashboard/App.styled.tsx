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
