FROM odoo:19

USER root
COPY scripts/start-odoo.sh /start-odoo.sh
RUN chmod +x /start-odoo.sh

USER odoo

# Must override ENTRYPOINT, not CMD — the base image's ENTRYPOINT
# would otherwise swallow your script as an argument.
# Your script calls /entrypoint.sh internally, so nothing is lost.
ENTRYPOINT ["/start-odoo.sh"]