DROP POLICY IF EXISTS orders_authenticated_update ON public.orders;
CREATE POLICY orders_authenticated_update ON public.orders
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT UPDATE ON public.orders TO authenticated;
