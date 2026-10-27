-- Bill numbers with Cash payment, received_amount > 0, present in BOTH tables
SELECT DISTINCT ab.bill_number
FROM approved_bills ab
WHERE ab.payment_method = 'Cash'
  AND ab.received_amount > 0
  AND EXISTS (
      SELECT 1 FROM ugrai_payment_history uph
      WHERE uph.bill_number = ab.bill_number
  )
ORDER BY ab.bill_number;

