"""Create and migrate fine-grained finance permission items.

Revision ID: 20260811_03
Revises: 20260811_02
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260811_03"
down_revision: Union[str, None] = "20260811_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO permission_items(key,menu_id,menu_key,action_key,label,source,sort_order,is_active)
        SELECT m.key || '.' || a.action_key, m.id, m.key, a.action_key, a.label, 'manual', a.sort_order, TRUE
        FROM app_menus m
        CROSS JOIN (VALUES
          ('view','ดู',10),('create','สร้าง/บันทึกจ่าย',20),('update','แก้ไข/ตรวจสอบ',30),
          ('delete','ยกเลิก',40),('approve','อนุมัติ/ตรวจผ่าน',50),('export','ส่งออก',60)
        ) AS a(action_key,label,sort_order)
        WHERE m.key IN ('expense_accounting','expense_settings')
        ON CONFLICT(key) DO UPDATE SET menu_id=EXCLUDED.menu_id,menu_key=EXCLUDED.menu_key,
          action_key=EXCLUDED.action_key,label=EXCLUDED.label,is_active=TRUE;

        -- Preserve explicit approval-matrix access under the new settings key.
        INSERT INTO permission_set_items(permission_set_id,permission_item_id)
        SELECT psi.permission_set_id,newpi.id
        FROM permission_set_items psi
        JOIN permission_items oldpi ON oldpi.id=psi.permission_item_id AND oldpi.menu_key='approval_matrix'
        JOIN permission_items newpi ON newpi.menu_key='expense_settings' AND newpi.action_key=oldpi.action_key
        ON CONFLICT(permission_set_id,permission_item_id) DO NOTHING;

        INSERT INTO user_permission_overrides(user_id,permission_item_id,is_allowed)
        SELECT o.user_id,newpi.id,o.is_allowed
        FROM user_permission_overrides o
        JOIN permission_items oldpi ON oldpi.id=o.permission_item_id AND oldpi.menu_key='approval_matrix'
        JOIN permission_items newpi ON newpi.menu_key='expense_settings' AND newpi.action_key=oldpi.action_key
        ON CONFLICT(user_id,permission_item_id) DO UPDATE SET is_allowed=EXCLUDED.is_allowed;

        -- Existing accounting-capable sets are identified by their current
        -- pay action; this avoids granting payment rights to ordinary requesters.
        INSERT INTO permission_set_items(permission_set_id,permission_item_id)
        SELECT DISTINCT psi.permission_set_id,newpi.id
        FROM permission_set_items psi
        JOIN permission_items marker ON marker.id=psi.permission_item_id AND marker.key='payables.pay'
        CROSS JOIN permission_items newpi
        WHERE newpi.menu_key='expense_accounting'
        ON CONFLICT(permission_set_id,permission_item_id) DO NOTHING;

        -- Platform/super-admin sets which can manage permissions inherit all
        -- finance settings actions even if the old matrix menu was never synced.
        INSERT INTO permission_set_items(permission_set_id,permission_item_id)
        SELECT DISTINCT psi.permission_set_id,newpi.id
        FROM permission_set_items psi
        JOIN permission_items marker ON marker.id=psi.permission_item_id AND marker.key='permissions.update'
        CROSS JOIN permission_items newpi
        WHERE newpi.menu_key='expense_settings'
        ON CONFLICT(permission_set_id,permission_item_id) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM permission_items WHERE menu_key IN ('expense_accounting','expense_settings');
    """)
