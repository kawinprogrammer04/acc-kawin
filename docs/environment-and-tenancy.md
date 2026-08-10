# Environment and tenant operations

The same application code is deployed separately for local and production.
The browser never receives database credentials and never selects a database
from `window.location.hostname`.

## Local

Copy `.env.local.example` to `.env`, replace all placeholders, then run:

```bash
make setup
make up
```

The services use these addresses:

- Browser/Vite: `http://localhost:5173`
- Docker/Nginx: `http://localhost:8080`
- Navicat: `127.0.0.1:5432`
- Backend inside Docker: database host `db`

Navicat's connection name is only a local label. The backend uses
`DATABASE_URL`, or builds one from `POSTGRES_*` when `DATABASE_URL` is empty.

## Production

Copy `.env.production.example` to `.env.production` on the production server.
Never commit that completed file.

Validate and deploy with:

```bash
make config ENV_FILE=.env.production
make up ENV_FILE=.env.production
make migration-current ENV_FILE=.env.production
```

`DATABASE_URL` should use a restricted application role.
`MIGRATION_DATABASE_URL` should use a schema-owner/migrator role. Keeping the
roles separate makes PostgreSQL Row-Level Security effective for normal API
queries while still allowing Alembic to update the schema.

For a brand-new external PostgreSQL database, initialize the project's base SQL
files in numeric order once, then run `alembic upgrade head`. Docker's `db`
service performs the base initialization automatically for an empty volume.

Do not expose production port 5432 publicly. Use an SSH tunnel, private network,
or VPN for Navicat access.

## Migrations and rollback safety

The backend entrypoint runs:

```bash
alembic upgrade head
```

before Uvicorn starts. Always take a PostgreSQL backup before deploying a new
revision. Useful commands:

```bash
make db-backup
make migration-current
make migrate
```

The first tenant migration backfills existing accounting data to company `1`;
it does not delete or renumber existing records. Existing additional companies
receive their own chart of accounts, fiscal year, and accounting periods.

## Tenant model

- `users` contains login identities shared across the platform.
- `companies` contains tenants.
- `user_companies` contains membership role and active status.
- Business records contain `company_id`.
- The frontend sends `X-Company-Id`.
- The backend validates membership and sets `app.current_company_id`.
- PostgreSQL RLS provides a second isolation layer.

Roles are evaluated per company:

- `admin`: company administration
- `approver`: approve/post entries
- `accountant`: create and edit entries
- `viewer`: read-only

`is_platform_admin` is separate and should be granted only to trusted Kawin
platform operators.

## Adding a company

Only a platform administrator can create a company. Creation automatically:

1. creates the company record;
2. copies cash-flow categories;
3. copies the chart of accounts and its parent hierarchy;
4. copies fiscal years and periods;
5. grants the creating platform administrator company-admin membership.

A company administrator can then open the Companies page and invite users with
a per-company role. Uploaded documents are stored below a company-specific
directory.

## Isolation verification

Before production deployment, verify at minimum:

1. a user belonging only to company A gets `200` for company A;
2. the same token gets `403` for company B;
3. codes and document numbers may repeat between companies;
4. reports, PDFs, uploads, journals, invoices, and cash flow never include rows
   from another `company_id`;
5. production connects with the restricted application database role.
