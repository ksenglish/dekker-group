-- The {{accept_link}} placeholder now renders as a styled "View Quote"
-- button in the sent HTML email (see quoteController.sendEmail), so the old
-- "click here: {{accept_link}}" inline phrasing reads oddly next to a
-- button. Only touch the default template if it still has the exact
-- original seeded wording — leave anything the user has since customised
-- alone.
UPDATE email_templates
SET body = E'Hi {{customer_first_name}},\n\nPlease find your quote from {{company_name}} attached.\n\nTotal: {{quote_total}} (incl. 15% GST)\n\nTo view and accept this quote online, click the button below:\n\n{{accept_link}}\n\nIf you have any questions, please don''t hesitate to get in touch.\n\nKind regards,\n{{sender_name}}\n{{company_name}}'
WHERE category = 'quote' AND is_default = true
  AND body = E'Hi {{customer_first_name}},\n\nPlease find your quote from {{company_name}} attached.\n\nTotal: {{quote_total}} (incl. 15% GST)\n\nTo view and accept this quote online, click here: {{accept_link}}\n\nIf you have any questions, please don''t hesitate to get in touch.\n\nKind regards,\n{{sender_name}}\n{{company_name}}';
