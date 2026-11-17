-- ============================================================================
-- Chrono Schema Migration 003: Authentic Email Enforcement
-- ============================================================================
-- Prevents registration with disposable, temporary, burner, or dummy emails
-- at the database level to ensure user authenticity.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_authentic_email()
RETURNS TRIGGER AS $$
DECLARE
    clean_email TEXT;
    email_local TEXT;
    email_domain TEXT;
BEGIN
    clean_email := lower(trim(NEW.email));

    IF clean_email IS NULL OR clean_email = '' OR clean_email NOT LIKE '%@%.%' THEN
        RAISE EXCEPTION 'A valid, authentic email address is required.';
    END IF;

    email_local := split_part(clean_email, '@', 1);
    email_domain := split_part(clean_email, '@', 2);

    -- 1. Enforce minimum username length
    IF length(email_local) < 2 THEN
        RAISE EXCEPTION 'Email username is too short to be authentic.';
    END IF;

    -- 2. Reject known disposable / temporary / burner email domains
    IF email_domain IN (
        'mailinator.com', 'mailinator2.com', 'mailin8r.com', 'mailinator.net',
        'tempmail.com', 'tempmail.net', 'temp-mail.org', 'temp-mail.io', 'tempemail.net',
        '10minutemail.com', '10minutemail.net', '10minmail.com', '10minutemail.be',
        'guerrillamail.com', 'guerrillamailblock.com', 'guerrillamail.net', 'guerrillamail.biz',
        'guerrillamail.org', 'guerrillamail.de', 'sharklasers.com', 'grr.la', 'spam4.me',
        'yopmail.com', 'yopmail.fr', 'yopmail.net', 'yopmail.be',
        'throwawaymail.com', 'throwaway.email',
        'trashmail.com', 'trashmail.net', 'trashmail.me', 'trashmail.org', 'trash-mail.com',
        'dispostable.com', 'maildrop.cc', 'inboxkitten.com', 'nada.ltd', 'getnada.com',
        'burnermail.io', 'dropmail.me', 'mohmal.com', 'mytemp.email', 'generator.email',
        'fakeinbox.com', 'crazymailing.com', 'discard.email', 'discardmail.com',
        'mintemail.com', 'spamgourmet.com', 'emailondeck.com', 'zillamail.com',
        'anonymbox.com', 'bugmenot.com', 'mailcatch.com', 'binkmail.com',
        'tempail.com', 'mailnesia.com', 'tempinbox.com', '0147.org', 'getairmail.com',
        'armyspy.com', 'cuvox.de', 'dayrep.com', 'einrot.com', 'fambest.com',
        'fleexy.com', 'gustr.com', 'jourrapide.com', 'rhyta.com', 'superrito.com', 'teleworm.us'
    ) THEN
        RAISE EXCEPTION 'Disposable and temporary email domains are not allowed. Please use an authentic email address.';
    END IF;

    -- 3. Reject placeholder / test domains
    IF email_domain IN (
        'example.com', 'example.org', 'example.net', 'example.edu',
        'test.com', 'testing.com', 'test.org', 'test.net', 'test.co',
        'fake.com', 'fakemail.com', 'fakedata.com', 'sample.com', 'dummy.com',
        'placeholder.com', 'asdf.com', 'qwerty.com', 'temp.com', 'foo.com', 'bar.com',
        'none.com', 'noemail.com', 'invalid.com', 'localhost'
    ) THEN
        RAISE EXCEPTION 'Test and placeholder domains are not allowed. Please use an authentic email address.';
    END IF;

    -- 4. Reject obvious dummy local-parts
    IF email_local IN (
        'test', 'dummy', 'fake', 'fakeuser', 'sample', 'random', 'nobody',
        'temp', 'asdf', 'qwerty', 'zxcvbnm', 'admin', 'noemail', 'null', 'undefined'
    ) THEN
        RAISE EXCEPTION 'Please use an authentic email address instead of a placeholder name.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to guard auth.users table on insert or update
DROP TRIGGER IF EXISTS trg_check_authentic_email ON auth.users;
CREATE TRIGGER trg_check_authentic_email
    BEFORE INSERT OR UPDATE OF email ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.check_authentic_email();
