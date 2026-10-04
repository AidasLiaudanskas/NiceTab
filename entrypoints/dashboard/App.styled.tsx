import styled from 'styled-components';

export const StyledDashboard = styled.div`
  min-height: 100vh;
  padding: 24px 32px 48px;
  box-sizing: border-box;
  color: ${props => props.theme.colorText || '#333'};

  .dashboard-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 8px;
  }
  .dashboard-title {
    font-size: 22px;
    font-weight: 600;
    margin: 0;
  }
  .dashboard-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dashboard-summary {
    font-size: 13px;
    opacity: 0.6;
    margin-bottom: 24px;
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
  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
    align-items: start;
  }
`;

export const StyledCategoryCard = styled.div<{ $color: string }>`
  border: 1px solid ${props => props.theme.colorBorderSecondary || '#eee'};
  border-top: 3px solid ${props => props.$color};
  border-radius: 8px;
  background: ${props => props.theme.colorBgContainer || '#fff'};
  overflow: hidden;

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 10px;
  }
  .card-name {
    font-size: 15px;
    font-weight: 600;
    color: ${props => props.$color};
  }
  .card-count {
    margin-left: auto;
    font-size: 20px;
    font-weight: 600;
    line-height: 1;
    color: ${props => props.$color};
  }
  .card-bar {
    height: 4px;
    background: ${props => props.theme.colorFillTertiary || '#f5f5f5'};
  }
  .card-bar-fill {
    height: 100%;
    background: ${props => props.$color};
    opacity: 0.55;
  }
  .card-list {
    padding: 6px 0 10px;
  }
  .card-more {
    padding: 6px 14px 0;
    font-size: 12px;
    opacity: 0.55;
  }
`;

export const StyledTabRow = styled.a`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  font-size: 13px;
  line-height: 1.4;
  color: inherit;
  text-decoration: none;

  &:hover {
    background: ${props => props.theme.colorFillQuaternary || '#fafafa'};
    color: inherit;
  }

  img {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 3px;
  }
  .row-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-host {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 11px;
    opacity: 0.45;
  }
`;
