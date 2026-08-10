FROM composer:2.8 AS vendor

WORKDIR /app
COPY dompdf_renderer/composer.json ./
RUN composer install \
    --no-dev \
    --no-interaction \
    --no-progress \
    --prefer-dist \
    --optimize-autoloader

FROM php:8.3-cli-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        fonts-tlwg-garuda \
        libfreetype6-dev \
        libjpeg62-turbo-dev \
        libonig-dev \
        libpng-dev \
        libxml2-dev \
        unzip && \
    docker-php-ext-configure gd --with-freetype --with-jpeg && \
    docker-php-ext-install -j"$(nproc)" dom gd mbstring && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=vendor /app/vendor ./vendor
COPY dompdf_renderer/public ./public
COPY dompdf_renderer/src ./src
COPY app/templates/tax_invoice_template.xlsx /tmp/tax_invoice_template.xlsx

RUN mkdir -p public/assets storage/fonts && \
    unzip -p /tmp/tax_invoice_template.xlsx xl/media/image1.png > public/assets/logo-customer.png && \
    unzip -p /tmp/tax_invoice_template.xlsx xl/media/image2.png > public/assets/logo-company.png && \
    unzip -p /tmp/tax_invoice_template.xlsx xl/media/image3.png > public/assets/logo-accounting.png && \
    cp /usr/share/fonts/truetype/tlwg/Garuda.ttf public/assets/Garuda.ttf && \
    cp /usr/share/fonts/truetype/tlwg/Garuda-Bold.ttf public/assets/Garuda-Bold.ttf && \
    chown -R www-data:www-data /app && \
    rm /tmp/tax_invoice_template.xlsx

USER www-data

EXPOSE 8090

CMD ["php", "-S", "0.0.0.0:8090", "-t", "public", "public/index.php"]
